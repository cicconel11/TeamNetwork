import test from "node:test";
import assert from "node:assert/strict";
import {
  getCaptchaErrorMessage,
  isLocalDevelopmentHostname,
  shouldAutoRetryCaptchaError,
} from "../src/components/ui/hcaptcha-utils.ts";

test("localhost development hosts are recognized for captcha recovery", () => {
  assert.equal(isLocalDevelopmentHostname("localhost", "development"), true);
  assert.equal(isLocalDevelopmentHostname("127.0.0.1", "development"), true);
  assert.equal(isLocalDevelopmentHostname("0.0.0.0", "development"), true);
  assert.equal(isLocalDevelopmentHostname("localhost", "production"), false);
  assert.equal(isLocalDevelopmentHostname("example.com", "development"), false);
});

test("network errors on localhost use the developer-friendly captcha guidance", () => {
  const message = getCaptchaErrorMessage("network-error", true);

  assert.match(message, /localhost/i);
  assert.match(message, /allowlist/i);
});

test("only localhost network errors trigger an automatic retry", () => {
  assert.equal(shouldAutoRetryCaptchaError("network-error", true), true);
  assert.equal(shouldAutoRetryCaptchaError("network-error", false), false);
  assert.equal(shouldAutoRetryCaptchaError("challenge-closed", true), false);
});
