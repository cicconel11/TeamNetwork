-- Add 'revoked' to member_status enum so the sync trigger can cast
-- membership_status('revoked') to member_status without error.
ALTER TYPE public.member_status ADD VALUE IF NOT EXISTS 'revoked';
