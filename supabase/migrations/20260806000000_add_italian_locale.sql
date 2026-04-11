-- Add Italian ('it') to the supported language CHECK constraints

BEGIN;

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS chk_org_default_language;

ALTER TABLE public.organizations
  ADD CONSTRAINT chk_org_default_language
  CHECK (default_language IN ('en', 'es', 'fr', 'ar', 'zh', 'pt', 'it'))
  NOT VALID;

ALTER TABLE public.organizations
  VALIDATE CONSTRAINT chk_org_default_language;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS chk_user_language_override;

ALTER TABLE public.users
  ADD CONSTRAINT chk_user_language_override
  CHECK (language_override IS NULL OR language_override IN ('en', 'es', 'fr', 'ar', 'zh', 'pt', 'it'))
  NOT VALID;

ALTER TABLE public.users
  VALIDATE CONSTRAINT chk_user_language_override;

COMMIT;
