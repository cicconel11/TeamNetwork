import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeMicrosoftRedirectPath } from "@/lib/microsoft/redirect";

describe("sanitizeMicrosoftRedirectPath", () => {
  it("preserves valid org-scoped calendar routes", () => {
    assert.equal(
      sanitizeMicrosoftRedirectPath("/alpha/calendar/my-settings"),
      "/alpha/calendar/my-settings",
    );
    assert.equal(
      sanitizeMicrosoftRedirectPath("/alpha/calendar/sources"),
      "/alpha/calendar/sources",
    );
    assert.equal(
      sanitizeMicrosoftRedirectPath("/alpha/calendar/events"),
      "/alpha/calendar/events",
    );
  });

  it("strips query params from valid org-scoped calendar routes", () => {
    assert.equal(
      sanitizeMicrosoftRedirectPath("/alpha/calendar?subview=list"),
      "/alpha/calendar",
    );
  });

  it("falls back for external or malformed redirect targets", () => {
    assert.equal(sanitizeMicrosoftRedirectPath("//evil.com"), "/settings/notifications");
    assert.equal(sanitizeMicrosoftRedirectPath("https://evil.com"), "/settings/notifications");
    assert.equal(sanitizeMicrosoftRedirectPath("/\\evil.com"), "/settings/notifications");
    assert.equal(sanitizeMicrosoftRedirectPath("/alpha/chat"), "/settings/notifications");
  });
});
