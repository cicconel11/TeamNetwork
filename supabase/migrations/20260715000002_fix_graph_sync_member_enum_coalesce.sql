-- Fix: COALESCE(NEW.status, '') blows up when status is a member_status enum
-- because '' is not a valid enum value. Use IS DISTINCT FROM instead.
CREATE OR REPLACE FUNCTION public.enqueue_graph_sync_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_action text;
  v_payload jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id)
       AND (NEW.user_id IS NOT DISTINCT FROM OLD.user_id)
       AND (NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at)
       AND (NEW.status IS NOT DISTINCT FROM OLD.status)
       AND (NEW.first_name IS NOT DISTINCT FROM OLD.first_name)
       AND (NEW.last_name IS NOT DISTINCT FROM OLD.last_name)
       AND (NEW.email IS NOT DISTINCT FROM OLD.email)
       AND (NEW.role IS NOT DISTINCT FROM OLD.role)
       AND (NEW.current_company IS NOT DISTINCT FROM OLD.current_company)
       AND (NEW.graduation_year IS NOT DISTINCT FROM OLD.graduation_year)
    THEN
      RETURN NEW;
    END IF;

    v_payload := jsonb_build_object(
      'old_user_id', OLD.user_id,
      'old_organization_id', OLD.organization_id
    );
  END IF;

  IF NEW.deleted_at IS NOT NULL OR NEW.status IS DISTINCT FROM 'active' THEN
    v_action := 'delete';
  ELSE
    v_action := 'upsert';
  END IF;

  INSERT INTO public.graph_sync_queue(org_id, source_table, source_id, action, payload)
  VALUES (NEW.organization_id, 'members', NEW.id, v_action, v_payload);

  RETURN NEW;
END;
$$;
