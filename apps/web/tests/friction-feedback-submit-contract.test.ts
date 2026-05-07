import test from "node:test";
import assert from "node:assert/strict";
import { frictionFeedbackSubmitSchema } from "@/lib/schemas/friction-feedback-submit";

/**
 * Contract between FeedbackButton (client JSON) and POST /api/feedback/submit.
 * Keeps the handler and UI aligned without a full route integration harness.
 */
test("Friction feedback JSON body matches frictionFeedbackSubmitSchema", () => {
  const parsed = frictionFeedbackSubmitSchema.parse({
    message: "The login button does nothing",
    page_url: "https://app.example.com/auth/login",
    user_agent: "Mozilla/5.0 (Test)",
    context: "login",
    trigger: "login_error",
  });
  assert.equal(parsed.message, "The login button does nothing");
  assert.equal(parsed.context, "login");
  assert.equal(parsed.trigger, "login_error");
  assert.equal(parsed.screenshot_url, undefined);
});

test("Friction feedback accepts optional private screenshot path", () => {
  const parsed = frictionFeedbackSubmitSchema.parse({
    message: "UI glitch",
    page_url: "https://app.example.com/page",
    user_agent: "Mozilla/5.0",
    context: "settings",
    trigger: "feedback_button",
    screenshot_url: "anonymous/123e4567-e89b-12d3-a456-426614174000.png",
  });
  assert.equal(parsed.screenshot_url, "anonymous/123e4567-e89b-12d3-a456-426614174000.png");
});

test("Friction feedback rejects unknown JSON keys (strict)", () => {
  assert.throws(
    () =>
      frictionFeedbackSubmitSchema.parse({
        message: "x",
        page_url: "https://a.com",
        user_agent: "ua",
        context: "c",
        trigger: "t",
        pageUrl: "wrong-key",
      }),
    /unrecognized/i,
  );
});

test("Friction feedback rejects invalid screenshot path", () => {
  assert.throws(
    () =>
      frictionFeedbackSubmitSchema.parse({
        message: "x",
        page_url: "https://a.com",
        user_agent: "ua",
        context: "c",
        trigger: "t",
        screenshot_url: "not-a-url",
      }),
  );
});
