-- Migration: Keep organization_donation_stats in sync with organization_donations
--
-- Background: organization_donation_stats is a one-row-per-org counter table.
-- It has drifted in production because it was populated only via the
-- increment_donation_stats RPC from select application code paths (primarily
-- the Stripe webhook). Manually-recorded donations (status='recorded') and
-- some direct inserts bypassed the RPC, so the counter undercounts reality.
--
-- Fix: add AFTER INSERT/UPDATE/DELETE trigger that applies deltas using the
-- same settled-status definition as the product (SETTLED_DONATION_STATUSES =
-- 'succeeded' + 'recorded') and honors soft deletes (deleted_at IS NULL).
-- Then backfill existing rows by recomputing from the live donations table.

-- Helper to compute "is this row countable" — matches SETTLED_DONATION_STATUSES
-- in src/lib/payments/donation-status.ts. Pure function (IMMUTABLE).
CREATE OR REPLACE FUNCTION public._donation_is_settled(
  p_status text,
  p_deleted_at timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_status IN ('succeeded', 'recorded') AND p_deleted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public._sync_donation_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_amount_delta bigint := 0;
  v_count_delta int := 0;
  v_org uuid;
  v_new_last timestamptz;
  v_old_counted boolean;
  v_new_counted boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new_counted := public._donation_is_settled(NEW.status, NEW.deleted_at);
    IF v_new_counted THEN
      v_amount_delta := COALESCE(NEW.amount_cents, 0);
      v_count_delta := 1;
      v_org := NEW.organization_id;
      v_new_last := NEW.created_at;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_old_counted := public._donation_is_settled(OLD.status, OLD.deleted_at);
    IF v_old_counted THEN
      v_amount_delta := -COALESCE(OLD.amount_cents, 0);
      v_count_delta := -1;
      v_org := OLD.organization_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old_counted := public._donation_is_settled(OLD.status, OLD.deleted_at);
    v_new_counted := public._donation_is_settled(NEW.status, NEW.deleted_at);

    IF v_old_counted AND NOT v_new_counted THEN
      v_amount_delta := -COALESCE(OLD.amount_cents, 0);
      v_count_delta := -1;
    ELSIF NOT v_old_counted AND v_new_counted THEN
      v_amount_delta := COALESCE(NEW.amount_cents, 0);
      v_count_delta := 1;
      v_new_last := NEW.created_at;
    ELSIF v_old_counted AND v_new_counted THEN
      v_amount_delta := COALESCE(NEW.amount_cents, 0) - COALESCE(OLD.amount_cents, 0);
      v_count_delta := 0;
      v_new_last := NEW.created_at;
    END IF;

    v_org := NEW.organization_id;
  END IF;

  IF v_count_delta <> 0 OR v_amount_delta <> 0 THEN
    INSERT INTO public.organization_donation_stats (
      organization_id,
      total_amount_cents,
      donation_count,
      last_donation_at
    )
    VALUES (
      v_org,
      v_amount_delta,
      v_count_delta,
      v_new_last
    )
    ON CONFLICT (organization_id) DO UPDATE SET
      total_amount_cents = public.organization_donation_stats.total_amount_cents + v_amount_delta,
      donation_count = public.organization_donation_stats.donation_count + v_count_delta,
      last_donation_at = COALESCE(
        GREATEST(public.organization_donation_stats.last_donation_at, EXCLUDED.last_donation_at),
        public.organization_donation_stats.last_donation_at,
        EXCLUDED.last_donation_at
      ),
      updated_at = timezone('utc', now());
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organization_donations_sync_stats ON public.organization_donations;
CREATE TRIGGER organization_donations_sync_stats
AFTER INSERT OR UPDATE OR DELETE ON public.organization_donations
FOR EACH ROW EXECUTE FUNCTION public._sync_donation_stats();

-- Backfill: recompute from the live donations table. Single pass, deterministic.
INSERT INTO public.organization_donation_stats (
  organization_id,
  total_amount_cents,
  donation_count,
  last_donation_at
)
SELECT
  d.organization_id,
  COALESCE(SUM(d.amount_cents), 0)::bigint,
  COUNT(*)::int,
  MAX(d.created_at)
FROM public.organization_donations d
WHERE d.deleted_at IS NULL
  AND d.status IN ('succeeded', 'recorded')
GROUP BY d.organization_id
ON CONFLICT (organization_id) DO UPDATE SET
  total_amount_cents = EXCLUDED.total_amount_cents,
  donation_count = EXCLUDED.donation_count,
  last_donation_at = EXCLUDED.last_donation_at,
  updated_at = timezone('utc', now());

-- Zero out any orgs whose stats row exists but has no countable donations
-- (e.g. all donations soft-deleted or status moved to 'failed'/'pending').
UPDATE public.organization_donation_stats s
SET
  total_amount_cents = 0,
  donation_count = 0,
  last_donation_at = NULL,
  updated_at = timezone('utc', now())
WHERE NOT EXISTS (
  SELECT 1 FROM public.organization_donations d
  WHERE d.organization_id = s.organization_id
    AND d.deleted_at IS NULL
    AND d.status IN ('succeeded', 'recorded')
);

-- Neutralize increment_donation_stats so the Stripe webhook path does not
-- double-count after the trigger. Caller signature preserved; body now only
-- touches updated_at so existing callers keep succeeding. The trigger is the
-- single source of truth going forward.
CREATE OR REPLACE FUNCTION public.increment_donation_stats(
  p_org_id uuid,
  p_amount_delta bigint,
  p_count_delta integer,
  p_last timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Trigger on organization_donations handles stats now. This RPC remains
  -- callable for backwards compatibility but is intentionally a no-op so
  -- webhook handlers (src/app/api/stripe/webhook-connect/route.ts) do not
  -- double-count alongside the trigger.
  RETURN;
END;
$$;
