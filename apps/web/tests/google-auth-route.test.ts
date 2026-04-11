import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sanitizeGoogleRedirectPath } from "@/lib/google/redirect";

describe("sanitizeGoogleRedirectPath", () => {
  it("preserves valid org-scoped calendar routes", () => {
    assert.equal(
      sanitizeGoogleRedirectPath("/alpha/calendar/my-settings"),
      "/alpha/calendar/my-settings",
    );
    assert.equal(
      sanitizeGoogleRedirectPath("/alpha/calendar/sources"),
      "/alpha/calendar/sources",
    );
    assert.equal(
      sanitizeGoogleRedirectPath("/alpha/calendar/events"),
      "/alpha/calendar/events",
    );
  });

  it("strips query params from valid org-scoped calendar routes", () => {
    assert.equal(
      sanitizeGoogleRedirectPath("/alpha/calendar?subview=list"),
      "/alpha/calendar",
    );
  });

  it("falls back for external or malformed redirect targets", () => {
    assert.equal(sanitizeGoogleRedirectPath("//evil.com"), "/settings/notifications");
    assert.equal(sanitizeGoogleRedirectPath("https://evil.com"), "/settings/notifications");
    assert.equal(sanitizeGoogleRedirectPath("/\\evil.com"), "/settings/notifications");
    assert.equal(sanitizeGoogleRedirectPath("/alpha/chat"), "/settings/notifications");
  });
});
