import test from "node:test";
import assert from "node:assert/strict";
import {
  AuthContext,
  isAuthenticated,
  AuthPresets,
} from "../../utils/authMock.ts";
import { isAnonymousFrictionAllowed } from "@/lib/feedback/anonymous-friction";

interface ScreenshotUploadRequest {
  auth: AuthContext;
  hasFile?: boolean;
  context?: string;
  trigger?: string;
}

interface ScreenshotUploadResult {
  status: number;
  screenshot_url?: string;
  error?: string;
}

function simulateScreenshotUpload(
  request: ScreenshotUploadRequest
): ScreenshotUploadResult {
  const authenticated = isAuthenticated(request.auth);
  const anonymousAllowed =
    !authenticated &&
    isAnonymousFrictionAllowed(request.context ?? "", request.trigger ?? "");

  if (!authenticated && !anonymousAllowed) {
    return { status: 401, error: "Unauthorized" };
  }

  if (!request.hasFile) {
    return { status: 400, error: "file is required" };
  }

  return {
    status: 200,
    screenshot_url:
      "https://project.supabase.co/storage/v1/object/public/feedback-screenshots/anonymous/test.png",
  };
}

test("screenshot upload rejects anonymous non-allowlisted flows", () => {
  const result = simulateScreenshotUpload({
    auth: AuthPresets.unauthenticated,
    hasFile: true,
    context: "join-org",
    trigger: "invite_error",
  });

  assert.equal(result.status, 401);
});

test("screenshot upload allows anonymous allowlisted auth friction", () => {
  const result = simulateScreenshotUpload({
    auth: AuthPresets.unauthenticated,
    hasFile: true,
    context: "login",
    trigger: "login_error",
  });

  assert.equal(result.status, 200);
  assert.match(result.screenshot_url ?? "", /feedback-screenshots/);
});

test("screenshot upload allows authenticated flows", () => {
  const result = simulateScreenshotUpload({
    auth: AuthPresets.authenticatedNoOrg,
    hasFile: true,
    context: "create-org",
    trigger: "checkout_error",
  });

  assert.equal(result.status, 200);
});

test("screenshot upload still requires a file", () => {
  const result = simulateScreenshotUpload({
    auth: AuthPresets.authenticatedNoOrg,
    hasFile: false,
    context: "create-org",
    trigger: "checkout_error",
  });

  assert.equal(result.status, 400);
});
