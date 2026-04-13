-- Add CHECK constraints to enterprise_invites for data integrity
-- Issue 6: Prevent uses_remaining from going negative
-- Issue 7: Prevent invalid enterprise-wide + active_member combination

ALTER TABLE enterprise_invites
  ADD CONSTRAINT enterprise_invites_uses_remaining_non_negative
  CHECK (uses_remaining IS NULL OR uses_remaining >= 0);

ALTER TABLE enterprise_invites
  ADD CONSTRAINT enterprise_invites_no_enterprise_wide_active_member
  CHECK (organization_id IS NOT NULL OR role != 'active_member');
