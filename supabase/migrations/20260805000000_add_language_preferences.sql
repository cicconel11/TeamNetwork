-- =====================================================
-- Migration: Add Language Preferences
-- Date: 2026-03-29
-- Purpose: Support i18n with org-level default language
--          and per-user language override
-- NOTE: Locale list is also defined in src/i18n/config.ts
--        and src/lib/schemas/organization.ts — keep in sync.
-- =====================================================

BEGIN;

-- Org-level default language (all members see this unless they override)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS default_language text NOT NULL DEFAULT 'en';

-- Use NOT VALID to avoid ACCESS EXCLUSIVE lock during full table scan
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS chk_org_default_language;

ALTER TABLE public.organizations
  ADD CONSTRAINT chk_org_default_language
  CHECK (default_language IN ('en', 'es', 'fr', 'ar', 'zh', 'pt'))
  NOT VALID;

ALTER TABLE public.organizations
  VALIDATE CONSTRAINT chk_org_default_language;

-- User-level language override (null = use org default)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS language_override text DEFAULT NULL;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS chk_user_language_override;

ALTER TABLE public.users
  ADD CONSTRAINT chk_user_language_override
  CHECK (language_override IS NULL OR language_override IN ('en', 'es', 'fr', 'ar', 'zh', 'pt'))
  NOT VALID;

ALTER TABLE public.users
  VALIDATE CONSTRAINT chk_user_language_override;

COMMIT;
