-- User onboarding progress table.
-- Tracks per-(user, org) checklist state: which items completed, which visited,
-- whether the welcome modal has been shown, and whether the checklist is dismissed.
-- One row per (user_id, organization_id) pair.

CREATE TABLE user_onboarding_progress (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id  uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- JSON arrays of onboarding item IDs (string[])
  completed_items  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  visited_items    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Timestamps for modal / tour completion
  welcome_seen_at     timestamptz,
  tour_completed_at   timestamptz,
  -- When the user dismissed the sidebar checklist (NULL = not dismissed)
  dismissed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, organization_id)
);

COMMENT ON TABLE user_onboarding_progress IS 'Per-(user, org) onboarding checklist state — completed items, visit tracking, modal/tour flags';
COMMENT ON COLUMN user_onboarding_progress.completed_items IS 'JSON array of completed onboarding item IDs';
COMMENT ON COLUMN user_onboarding_progress.visited_items   IS 'JSON array of visited (client-side) onboarding item IDs';
COMMENT ON COLUMN user_onboarding_progress.dismissed_at    IS 'NULL = checklist visible; non-NULL = user dismissed it';

-- Indexes
CREATE INDEX idx_onboarding_progress_user_org
  ON user_onboarding_progress(user_id, organization_id);

-- Row Level Security
ALTER TABLE user_onboarding_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY onboarding_progress_select ON user_onboarding_progress
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY onboarding_progress_insert ON user_onboarding_progress
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY onboarding_progress_update ON user_onboarding_progress
  FOR UPDATE USING (user_id = auth.uid());

-- updated_at auto-maintenance (reuses existing function defined in 20251215000000_embeds_fix_and_approvals.sql)
DROP TRIGGER IF EXISTS user_onboarding_progress_updated_at ON public.user_onboarding_progress;
CREATE TRIGGER user_onboarding_progress_updated_at
  BEFORE UPDATE ON public.user_onboarding_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
