-- Apple App Review reframe: the client now emits "support_*" behavioral analytics
-- event names instead of "donation_*" (no charitable-donation framing). This is
-- additive — the old donation_* enum values are retained (Postgres enum values
-- cannot be dropped) and stay allow-listed for any in-flight clients.
--
-- ADD VALUE is kept in its OWN migration (separate transaction) from the
-- log_analytics_event allow-list update, because a freshly added enum value
-- cannot be referenced in the same transaction that adds it.
ALTER TYPE public.analytics_event_name ADD VALUE IF NOT EXISTS 'support_flow_start';
ALTER TYPE public.analytics_event_name ADD VALUE IF NOT EXISTS 'support_checkout_start';
ALTER TYPE public.analytics_event_name ADD VALUE IF NOT EXISTS 'support_checkout_result';
