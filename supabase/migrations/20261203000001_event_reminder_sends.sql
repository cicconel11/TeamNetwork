-- Dedup table for one-shot event reminders. The `event-reminders` cron writes
-- one row per (event_id, kind) it has fired so the same reminder doesn't
-- enqueue twice if cron runs overlap or an event lingers in the firing window.
CREATE TABLE IF NOT EXISTS public.event_reminder_sends (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  kind text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, kind)
);

-- No RLS: only service-role writes from the cron worker. RLS would block
-- those by default; explicit lockdown is unnecessary because the table holds
-- no user-readable data.
ALTER TABLE public.event_reminder_sends ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.event_reminder_sends IS
  'Idempotency log for event reminder pushes. One row per (event_id, kind) once a reminder is enqueued.';
