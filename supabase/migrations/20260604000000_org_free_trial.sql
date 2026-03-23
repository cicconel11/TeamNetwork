ALTER TABLE public.payment_attempts
ADD COLUMN IF NOT EXISTS is_trial boolean NOT NULL DEFAULT false;

ALTER TABLE public.organization_subscriptions
ADD COLUMN IF NOT EXISTS is_trial boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS payment_attempts_user_trial_lookup_idx
  ON public.payment_attempts(user_id, organization_id)
  WHERE is_trial = true;

CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_one_consumed_trial_per_user_idx
  ON public.payment_attempts(user_id)
  WHERE is_trial = true AND user_id IS NOT NULL AND organization_id IS NOT NULL;
