-- Simplify AI spend cap: collapse charge + read into one RPC, drop legacy.
-- p_cents = 0 → pure read (gate). p_cents > 0 → atomic upsert + read.
-- Stores cents * 10_000 as microusd to preserve existing column shape.
-- Reads cap from organization_subscriptions.ai_monthly_cap_cents
-- (falls back to 2200 default).

CREATE OR REPLACE FUNCTION public.charge_and_check_ai_spend(
  p_org_id uuid,
  p_cents  integer
) RETURNS TABLE (
  allowed     boolean,
  spend_cents integer,
  cap_cents   integer,
  period_end  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period      date := date_trunc('month', timezone('UTC', now()))::date;
  v_period_end  timestamptz := (date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month' - interval '1 millisecond') AT TIME ZONE 'UTC';
  v_microusd    bigint := GREATEST(p_cents, 0)::bigint * 10000;
  v_spend_micro bigint;
  v_cap         integer;
BEGIN
  IF v_microusd > 0 THEN
    INSERT INTO public.ai_spend_ledger AS l (org_id, period_start, spend_microusd, request_count)
      VALUES (p_org_id, v_period, v_microusd, 1)
      ON CONFLICT (org_id, period_start) DO UPDATE
        SET spend_microusd = l.spend_microusd + EXCLUDED.spend_microusd,
            request_count  = l.request_count + 1,
            updated_at     = now()
      RETURNING l.spend_microusd INTO v_spend_micro;
  ELSE
    SELECT l.spend_microusd INTO v_spend_micro
      FROM public.ai_spend_ledger l
     WHERE l.org_id = p_org_id AND l.period_start = v_period;
    v_spend_micro := COALESCE(v_spend_micro, 0);
  END IF;

  SELECT COALESCE(s.ai_monthly_cap_cents, 2200) INTO v_cap
    FROM public.organization_subscriptions s
   WHERE s.organization_id = p_org_id;
  v_cap := COALESCE(v_cap, 2200);
  IF v_cap <= 0 THEN v_cap := 2200; END IF;

  RETURN QUERY SELECT
    (ROUND(v_spend_micro / 10000.0)::integer < v_cap) AS allowed,
    ROUND(v_spend_micro / 10000.0)::integer            AS spend_cents,
    v_cap                                              AS cap_cents,
    v_period_end                                       AS period_end;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.charge_and_check_ai_spend(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.charge_and_check_ai_spend(uuid, integer) TO service_role;

COMMENT ON FUNCTION public.charge_and_check_ai_spend(uuid, integer) IS
  'Single RPC for AI spend cap. p_cents=0 reads + gates; p_cents>0 atomically charges + reads. Returns post-state with cap.';

DROP FUNCTION IF EXISTS public.charge_ai_spend(uuid, bigint);
DROP FUNCTION IF EXISTS public.get_ai_spend_for_period(uuid);
