import { afterEach, describe, it } from "node:test";
import assert from "node:assert";
import { validateCaptchaEnv } from "../src/lib/env.ts";

const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
}

function clearCaptchaEnv() {
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
}

describe("captcha env validation", () => {
  afterEach(resetEnv);

  it("accepts Turnstile keys in production", () => {
    process.env.NODE_ENV = "production";
    clearCaptchaEnv();
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "turnstile-site";

    assert.doesNotThrow(() => validateCaptchaEnv());
  });

  it("throws when Turnstile secret missing in production", () => {
    process.env.NODE_ENV = "production";
    clearCaptchaEnv();
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "turnstile-site";

    assert.throws(
      () => validateCaptchaEnv(),
      /TURNSTILE_SECRET_KEY/,
    );
  });
});
