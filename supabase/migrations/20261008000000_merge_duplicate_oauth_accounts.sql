-- One-time backfill: copy user_organization_roles across duplicate OAuth accounts
-- sharing the same email. Idempotent. Does NOT delete any auth.users records.
-- The handle_org_member_sync() trigger fires on each INSERT, cascading to
-- public.members, public.alumni, and public.parents automatically.
--
-- Problem: Supabase creates separate auth.users records (different UUIDs) per OAuth
-- provider when no identity linking is configured. This copies all org memberships
-- from one UUID to any other UUID(s) sharing the same email, ensuring every identity
-- for the same person has access to the same orgs.
--
-- Safe to run multiple times (idempotent via ON CONFLICT DO NOTHING).

DO $$
DECLARE
  v_source_user_id   uuid;
  v_target_user_id   uuid;
  v_email            text;
  v_rows_copied      integer := 0;
  v_emails_processed integer := 0;
BEGIN
  -- For every email that has more than one auth.users record:
  FOR v_email IN
    SELECT email
    FROM auth.users
    WHERE email IS NOT NULL
    GROUP BY email
    HAVING count(*) > 1
  LOOP
    v_emails_processed := v_emails_processed + 1;

    -- For each source UUID that actually has org memberships:
    FOR v_source_user_id IN
      SELECT DISTINCT uor.user_id
      FROM public.user_organization_roles uor
      JOIN auth.users au ON au.id = uor.user_id
      WHERE au.email = v_email
    LOOP
      -- Copy those memberships to every OTHER UUID sharing the same email:
      FOR v_target_user_id IN
        SELECT id
        FROM auth.users
        WHERE email = v_email
          AND id <> v_source_user_id
      LOOP
        INSERT INTO public.user_organization_roles (
          user_id,
          organization_id,
          role,
          status,
          created_at
        )
        SELECT
          v_target_user_id,
          uor.organization_id,
          uor.role,
          uor.status,
          uor.created_at
        FROM public.user_organization_roles uor
        WHERE uor.user_id = v_source_user_id
        ON CONFLICT (user_id, organization_id) DO NOTHING;

        GET DIAGNOSTICS v_rows_copied = ROW_COUNT;
        RAISE NOTICE 'email=% source=% target=% rows_inserted=%',
          v_email, v_source_user_id, v_target_user_id, v_rows_copied;
      END LOOP;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Backfill complete. Emails with duplicates processed: %', v_emails_processed;
END
$$;
