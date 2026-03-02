-- Add anonymous flag to organization_donations
ALTER TABLE organization_donations
  ADD COLUMN anonymous boolean NOT NULL DEFAULT false;
