-- Parents schema fixes (four issues)
--
-- Issue #1 (HIGH):   Restore SET search_path = '' on handle_org_member_sync.
--   Migration 20260614 recreated this SECURITY DEFINER function (to add parents
--   sync) but omitted the SET search_path = '' directive that was originally added
--   by 20260207100000_security_lint_fixes_v2.sql. Without a pinned search_path,
--   SECURITY DEFINER functions inherit the caller's search path, creating a path
--   for schema injection attacks.
--
-- Issue #2 (MEDIUM): Add update_updated_at_column() trigger to parents.
--   The parents table has an updated_at column but the auto-update trigger was
--   never attached. Every other mutable table has this trigger. Application code
--   works around it today but direct DB mutations would leave updated_at stale.
--
-- Issue #3 (MEDIUM): Add explicit WITH CHECK to parents_update RLS policy.
--   The policy from 20260609000000_parents_allow_self_update.sql has only USING,
--   no explicit WITH CHECK. PostgreSQL implicitly uses USING as the WITH CHECK,
--   but alumni's equivalent policy has an explicit matching WITH CHECK. Defense
--   in depth: make the policy self-documenting and consistent with alumni.
--
-- Issue #4 (LOW):    Drop redundant non-partial parents_org_idx.
--   20260608000002 created both parents_org_idx (plain) and parents_org_deleted_idx
--   (partial, WHERE deleted_at IS NULL). Every real query filters deleted_at IS NULL
--   so the planner prefers the partial index. The plain index adds write overhead
--   with no benefit. Alumni only has the partial version.

-- ── Issue #1: Restore SET search_path = '' on handle_org_member_sync ─────────
-- Full function body matches 20260614000000_sync_parents_on_org_membership.sql
-- exactly; only the security header is changed (SET search_path = '' added back).

CREATE OR REPLACE FUNCTION public.handle_org_member_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_email text;
  v_first_name text;
  v_last_name text;
  v_avatar_url text;
  v_member_id uuid;
  v_alumni_id uuid;
  v_parent_id uuid;
BEGIN
  -- Get user details from auth.users
  SELECT
    email,
    COALESCE(raw_user_meta_data->>'first_name', split_part(COALESCE(raw_user_meta_data->>'full_name', 'Member'), ' ', 1)),
    COALESCE(raw_user_meta_data->>'last_name', split_part(COALESCE(raw_user_meta_data->>'full_name', ''), ' ', 2)),
    raw_user_meta_data->>'avatar_url'
  INTO v_user_email, v_first_name, v_last_name, v_avatar_url
  FROM auth.users
  WHERE id = NEW.user_id;

  -- Ensure we have defaults if auth data is missing
  v_first_name := COALESCE(v_first_name, 'Member');
  v_last_name := COALESCE(v_last_name, '');

  -- 1. Sync to public.members
  -- Check if member entry exists for this user+org (by user_id OR email)
  SELECT id INTO v_member_id
  FROM public.members
  WHERE organization_id = NEW.organization_id
    AND (user_id = NEW.user_id OR (email IS NOT NULL AND email = v_user_email))
  LIMIT 1;

  IF v_member_id IS NOT NULL THEN
    -- Update existing member
    UPDATE public.members
    SET
      user_id = NEW.user_id, -- Link user_id if it was missing
      role = NEW.role,
      status = NEW.status::text::public.member_status,
      updated_at = now()
    WHERE id = v_member_id;
  ELSE
    -- Insert new member
    INSERT INTO public.members (
      organization_id,
      user_id,
      first_name,
      last_name,
      email,
      photo_url,
      role,
      status
    )
    VALUES (
      NEW.organization_id,
      NEW.user_id,
      v_first_name,
      v_last_name,
      v_user_email,
      v_avatar_url,
      NEW.role,
      NEW.status::text::public.member_status
    );
  END IF;

  -- 2. Sync to public.alumni if role is ALUMNI
  IF NEW.role = 'alumni' THEN
    SELECT id INTO v_alumni_id
    FROM public.alumni
    WHERE organization_id = NEW.organization_id
      AND (user_id = NEW.user_id OR (email IS NOT NULL AND email = v_user_email))
    LIMIT 1;

    IF v_alumni_id IS NOT NULL THEN
       -- Existing alumni, just link user_id and touch updated_at
       UPDATE public.alumni
       SET
         user_id = NEW.user_id,
         updated_at = now()
       WHERE id = v_alumni_id;
    ELSE
       -- Enforce alumni quota before creating a new profile
       PERFORM public.assert_alumni_quota(NEW.organization_id);

       -- Create alumni profile
       INSERT INTO public.alumni (
         organization_id,
         user_id,
         first_name,
         last_name,
         email,
         photo_url
       )
       VALUES (
         NEW.organization_id,
         NEW.user_id,
         v_first_name,
         v_last_name,
         v_user_email,
         v_avatar_url
       );
    END IF;
  END IF;

  -- 3. Sync to public.parents if role is PARENT
  IF NEW.role = 'parent' THEN
    SELECT id INTO v_parent_id
    FROM public.parents
    WHERE organization_id = NEW.organization_id
      AND deleted_at IS NULL
      AND (
        user_id = NEW.user_id OR (
          v_user_email IS NOT NULL
          AND email IS NOT NULL
          AND lower(email) = lower(v_user_email)
        )
      )
    LIMIT 1;

    IF v_parent_id IS NOT NULL THEN
      -- Link existing parent record without overwriting admin-entered fields
      UPDATE public.parents
      SET
        user_id = NEW.user_id,
        email = COALESCE(email, v_user_email),
        photo_url = COALESCE(photo_url, v_avatar_url),
        updated_at = now()
      WHERE id = v_parent_id;
    ELSE
      -- Create new parent profile
      INSERT INTO public.parents (
        organization_id,
        user_id,
        first_name,
        last_name,
        email,
        photo_url
      )
      VALUES (
        NEW.organization_id,
        NEW.user_id,
        v_first_name,
        v_last_name,
        v_user_email,
        v_avatar_url
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── Issue #2: Add update_updated_at_column() trigger to parents ───────────────

DROP TRIGGER IF EXISTS parents_updated_at ON public.parents;

CREATE TRIGGER parents_updated_at
  BEFORE UPDATE ON public.parents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ── Issue #3: Add explicit WITH CHECK to parents_update RLS policy ────────────
-- Mirrors the alumni UPDATE policy which has matching USING and WITH CHECK.
-- The protect_parents_self_edit trigger (20260616000001) provides defense-in-depth
-- against org-hopping, but the RLS layer should be self-sufficient.

DROP POLICY IF EXISTS "parents_update" ON public.parents;

CREATE POLICY "parents_update" ON public.parents FOR UPDATE
  USING (
    public.is_org_admin(organization_id)
    OR (user_id IS NOT NULL AND user_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    public.is_org_admin(organization_id)
    OR (user_id IS NOT NULL AND user_id = (SELECT auth.uid()))
  );

-- ── Issue #4: Drop redundant non-partial org index ────────────────────────────
-- parents_org_deleted_idx (partial, WHERE deleted_at IS NULL) is the correct
-- index — all real queries filter soft-deleted rows. The plain parents_org_idx
-- adds write overhead with no query benefit.

DROP INDEX IF EXISTS public.parents_org_idx;
