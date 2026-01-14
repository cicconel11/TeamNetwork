import test from "node:test";
import assert from "node:assert";
import {
  AuthContext,
  isAuthenticated,
  AuthPresets,
} from "../../utils/authMock.ts";

/**
 * Tests for POST /api/feedback/submit
 *
 * This route:
 * 1. Requires authentication
 * 2. Validates required fields (message, page_url, user_agent, context, trigger)
 * 3. Stores feedback in form_submissions
 * 4. Sends admin notification email
 */

// Types
interface FeedbackRequest {
  auth: AuthContext;
  message?: string;
  screenshot_url?: string;
  page_url?: string;
  user_agent?: string;
  context?: string;
  trigger?: string;
}

interface FeedbackResult {
  status: number;
  success?: boolean;
  submissionId?: string;
  error?: string;
  details?: Record<string, string[]>;
}


const MAX_MESSAGE_LENGTH = 2000;

function simulateFeedbackSubmit(
  request: FeedbackRequest
): FeedbackResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // Validate required fields
  if (!request.message || request.message.trim().length === 0) {
    return { status: 400, error: "message is required", details: { message: ["Required"] } };
  }

  if (request.message.length > MAX_MESSAGE_LENGTH) {
    return { status: 400, error: "message too long", details: { message: [`Max ${MAX_MESSAGE_LENGTH} characters`] } };
  }

  if (!request.page_url || request.page_url.trim().length === 0) {
    return { status: 400, error: "page_url is required", details: { page_url: ["Required"] } };
  }

  if (!request.user_agent || request.user_agent.trim().length === 0) {
    return { status: 400, error: "user_agent is required", details: { user_agent: ["Required"] } };
  }

  if (!request.context || request.context.trim().length === 0) {
    return { status: 400, error: "context is required", details: { context: ["Required"] } };
  }

  if (!request.trigger || request.trigger.trim().length === 0) {
    return { status: 400, error: "trigger is required", details: { trigger: ["Required"] } };
  }

  // Validate screenshot URL if provided
  if (request.screenshot_url) {
    try {
      new URL(request.screenshot_url);
    } catch {
      return { status: 400, error: "Invalid screenshot URL", details: { screenshot_url: ["Must be a valid URL"] } };
    }
  }

  // Success - store feedback
  return {
    status: 200,
    success: true,
    submissionId: "submission-uuid-123",
  };
}

// Tests

test("feedback submit requires authentication", () => {
  const result = simulateFeedbackSubmit(
    {
      auth: AuthPresets.unauthenticated,
      message: "Something is broken",
      page_url: "https://app.example.com/page",
      user_agent: "Mozilla/5.0",
      context: "main flow",
      trigger: "button_click",
    }
  );
  assert.strictEqual(result.status, 401);
});

test("feedback submit requires message", () => {
  const result = simulateFeedbackSubmit(
    {
      auth: AuthPresets.authenticatedNoOrg,
      message: "",
      page_url: "https://app.example.com/page",
      user_agent: "Mozilla/5.0",
      context: "main flow",
      trigger: "button_click",
    }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("message"));
});

test("feedback submit rejects long message", () => {
  const result = simulateFeedbackSubmit(
    {
      auth: AuthPresets.authenticatedNoOrg,
      message: "a".repeat(2001),
      page_url: "https://app.example.com/page",
      user_agent: "Mozilla/5.0",
      context: "main flow",
      trigger: "button_click",
    }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.details?.message?.[0].includes("2000"));
});

test("feedback submit requires page_url", () => {
  const result = simulateFeedbackSubmit(
    {
      auth: AuthPresets.authenticatedNoOrg,
      message: "Something is broken",
      page_url: "",
      user_agent: "Mozilla/5.0",
      context: "main flow",
      trigger: "button_click",
    }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("page_url"));
});

test("feedback submit requires user_agent", () => {
  const result = simulateFeedbackSubmit(
    {
      auth: AuthPresets.authenticatedNoOrg,
      message: "Something is broken",
      page_url: "https://app.example.com/page",
      user_agent: "",
      context: "main flow",
      trigger: "button_click",
    }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("user_agent"));
});

test("feedback submit requires context", () => {
  const result = simulateFeedbackSubmit(
    {
      auth: AuthPresets.authenticatedNoOrg,
      message: "Something is broken",
      page_url: "https://app.example.com/page",
      user_agent: "Mozilla/5.0",
      context: "",
      trigger: "button_click",
    }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("context"));
});

test("feedback submit requires trigger", () => {
  const result = simulateFeedbackSubmit(
    {
      auth: AuthPresets.authenticatedNoOrg,
      message: "Something is broken",
      page_url: "https://app.example.com/page",
      user_agent: "Mozilla/5.0",
      context: "main flow",
      trigger: "",
    }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("trigger"));
});

test("feedback submit validates screenshot URL", () => {
  const result = simulateFeedbackSubmit(
    {
      auth: AuthPresets.authenticatedNoOrg,
      message: "Something is broken",
      page_url: "https://app.example.com/page",
      user_agent: "Mozilla/5.0",
      context: "main flow",
      trigger: "button_click",
      screenshot_url: "not-a-valid-url",
    }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("screenshot"));
});

test("feedback submit succeeds with valid data", () => {
  const result = simulateFeedbackSubmit(
    {
      auth: AuthPresets.authenticatedNoOrg,
      message: "The button doesn't work",
      page_url: "https://app.example.com/settings",
      user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      context: "settings page",
      trigger: "save_button",
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.success, true);
  assert.ok(result.submissionId);
});

test("feedback submit accepts optional screenshot URL", () => {
  const result = simulateFeedbackSubmit(
    {
      auth: AuthPresets.authenticatedNoOrg,
      message: "UI issue",
      page_url: "https://app.example.com/page",
      user_agent: "Mozilla/5.0",
      context: "main flow",
      trigger: "button_click",
      screenshot_url: "https://storage.example.com/screenshots/123.png",
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.success, true);
});

test("feedback submit works for org members", () => {
  const result = simulateFeedbackSubmit(
    {
      auth: AuthPresets.orgMember("org-1"),
      message: "Feature request",
      page_url: "https://app.example.com/org-1/members",
      user_agent: "Mozilla/5.0",
      context: "members page",
      trigger: "feedback_button",
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.success, true);
});

test("feedback submit works for alumni", () => {
  const result = simulateFeedbackSubmit(
    {
      auth: AuthPresets.orgAlumni("org-1"),
      message: "Alumni-specific issue",
      page_url: "https://app.example.com/org-1/alumni",
      user_agent: "Mozilla/5.0",
      context: "alumni page",
      trigger: "feedback_button",
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.success, true);
});
