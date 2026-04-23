-- Per-organization captcha provider override.
-- NULL = fall back to CAPTCHA_PROVIDER env var (default: hcaptcha).
-- Enables tenant-by-tenant rollout of Cloudflare Turnstile without redeploy.

ALTER TABLE organizations
  ADD COLUMN captcha_provider TEXT
    CHECK (captcha_provider IN ('hcaptcha', 'turnstile'));

COMMENT ON COLUMN organizations.captcha_provider IS
  'Per-org captcha provider override for donation flow. NULL falls back to CAPTCHA_PROVIDER env var.';
