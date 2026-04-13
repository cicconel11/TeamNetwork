-- Phase 4 (A4): Breach incident tracking for NY Education Law 2-d compliance
--
-- Tracks security incidents with notification timestamps to verify
-- compliance with mandatory timelines: 72hr vendor→school, 10-day state,
-- 14-day parents.

CREATE TABLE public.breach_incidents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discovered_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  tier                  INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 3),
  description           TEXT NOT NULL,
  affected_tables       TEXT[] NOT NULL DEFAULT '{}',
  estimated_record_count INTEGER,
  district_notified_at  TIMESTAMPTZ,
  state_notified_at     TIMESTAMPTZ,
  parents_notified_at   TIMESTAMPTZ,
  resolved_at           TIMESTAMPTZ,
  resolution_notes      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Service-role-only: no authenticated user should access directly
ALTER TABLE public.breach_incidents ENABLE ROW LEVEL SECURITY;
