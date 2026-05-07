import { afterEach, describe, it } from "node:test";
import assert from "node:assert";
import { validateCaptchaEnv } from "../src/lib/env.ts";

const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
}

function clearCaptchaEnv() {
  delete process.env.CAPTCHA_PROVIDER;
  delete process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER;
  delete process.env.HCAPTCHA_SECRET_KEY;
  delete process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
}

describe("captcha env validation", () => {
  afterEach(resetEnv);

  it("uses Turnstile as the production default without requiring hCaptcha keys", () => {
    process.env.NODE_ENV = "production";
    clearCaptchaEnv();
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "turnstile-site";

    assert.doesNotThrow(() => validateCaptchaEnv());
  });

  it("requires hCaptcha keys only when hCaptcha is explicitly selected", () => {
    process.env.NODE_ENV = "production";
    clearCaptchaEnv();
    process.env.CAPTCHA_PROVIDER = "hcaptcha";
    process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER = "hcaptcha";

    assert.throws(
      () => validateCaptchaEnv(),
      /HCAPTCHA_SECRET_KEY/,
    );
  });
});
