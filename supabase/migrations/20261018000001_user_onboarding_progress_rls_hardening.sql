-- Harden RLS on user_onboarding_progress.
-- Fixes review finding: UPDATE policy lacked WITH CHECK, so an authenticated
-- user could UPDATE their own row and set user_id to another user's UUID.
-- Also adds a DELETE policy for user-owned rows (GDPR / reset support).

-- Recreate UPDATE policy with WITH CHECK to prevent user_id hijack.
DROP POLICY IF EXISTS onboarding_progress_update ON user_onboarding_progress;
CREATE POLICY onboarding_progress_update ON user_onboarding_progress
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Allow users to delete their own onboarding row (reset flow / GDPR).
DROP POLICY IF EXISTS onboarding_progress_delete ON user_onboarding_progress;
CREATE POLICY onboarding_progress_delete ON user_onboarding_progress
  FOR DELETE
  USING (user_id = auth.uid());
