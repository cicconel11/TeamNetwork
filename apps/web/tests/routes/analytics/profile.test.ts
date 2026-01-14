import test from "node:test";
import assert from "node:assert";

/**
 * Tests for GET /api/analytics/profile?orgId=<uuid>
 *
 * This route:
 * 1. Requires authentication (401 if no user)
 * 2. Requires orgId query parameter (400 if missing)
 * 3. Validates UUID format (400 if invalid)
 * 4. Returns default profile if not consented (with consented: false)
 * 5. Checks org membership (403 if not a member)
 * 6. Returns default profile if org not found (with consented: true)
 * 7. Returns default profile if no ANTHROPIC_API_KEY (with consented: true)
 * 8. Returns LLM-generated profile if available (with consented: true)
 * 9. IMPORTANT: All successful responses include `consented: true/false` (Issue 14)
 */

// Types
interface AuthContext {
  user: { id: string; email?: string; age_bracket?: string } | null;
}

function isAuthenticated(ctx: AuthContext): boolean {
  return ctx.user !== null && ctx.user.id !== "";
}

interface DashboardHints {
  show_recent_features: boolean;
  suggested_features: string[];
  preferred_time_label: string;
}

interface UIProfile {
  nav_order: string[];
  feature_highlights: string[];
  dashboard_hints: DashboardHints;
}

const DEFAULT_PROFILE: UIProfile = {
  nav_order: [],
  feature_highlights: [],
  dashboard_hints: {
    show_recent_features: false,
    suggested_features: [],
    preferred_time_label: "",
  },
};

interface ProfileRequest {
  auth: AuthContext;
  orgId?: string;
  consented?: boolean;
  isMember?: boolean;
  orgExists?: boolean;
  hasApiKey?: boolean;
  llmResult?: UIProfile | null;
}

interface ProfileResult {
  status: number;
  profile?: UIProfile;
  consented?: boolean;
  error?: string;
}

function simulateProfileGet(request: ProfileRequest): ProfileResult {
  // 1. Check authentication
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // 2. Check orgId parameter
  if (!request.orgId) {
    return { status: 400, error: "orgId query parameter is required" };
  }

  // 3. Validate UUID format
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(request.orgId)) {
    return { status: 400, error: "Invalid orgId format" };
  }

  // 4. Check consent
  const consented = request.consented ?? true;
  if (!consented) {
    return { status: 200, profile: DEFAULT_PROFILE, consented: false };
  }

  // 5. Check org membership
  const isMember = request.isMember ?? true;
  if (!isMember) {
    return { status: 403, error: "Not a member of this organization" };
  }

  // 6. Check if org exists
  const orgExists = request.orgExists ?? true;
  if (!orgExists) {
    return { status: 200, profile: DEFAULT_PROFILE, consented: true };
  }

  // 7. Check if LLM provider configured
  const hasApiKey = request.hasApiKey ?? true;
  if (!hasApiKey) {
    return { status: 200, profile: DEFAULT_PROFILE, consented: true };
  }

  // 8. Return LLM-generated profile or default on error
  const llmResult = request.llmResult;
  if (llmResult === undefined) {
    // LLM call successful with valid profile
    const mockProfile: UIProfile = {
      nav_order: ["dashboard", "members", "chat"],
      feature_highlights: ["members", "chat"],
      dashboard_hints: {
        show_recent_features: true,
        suggested_features: ["chat", "events"],
        preferred_time_label: "afternoon",
      },
    };
    return { status: 200, profile: mockProfile, consented: true };
  }

  if (llmResult === null) {
    // LLM error - graceful degradation
    return { status: 200, profile: DEFAULT_PROFILE, consented: true };
  }

  // LLM success with custom profile
  return { status: 200, profile: llmResult, consented: true };
}

// Tests

test("profile GET requires authentication", () => {
  const result = simulateProfileGet({
    auth: { user: null },
    orgId: "00000000-0000-0000-0000-000000000001",
  });
  assert.strictEqual(result.status, 401);
});

test("profile GET requires orgId parameter", () => {
  const result = simulateProfileGet({
    auth: { user: { id: "user-123" } },
    orgId: undefined,
  });
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("orgId"));
});

test("profile GET validates UUID format - invalid format", () => {
  const result = simulateProfileGet({
    auth: { user: { id: "user-123" } },
    orgId: "not-a-uuid",
  });
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("Invalid orgId"));
});

test("profile GET validates UUID format - valid UUID", () => {
  const result = simulateProfileGet({
    auth: { user: { id: "user-123" } },
    orgId: "12345678-1234-1234-1234-123456789abc",
  });
  assert.strictEqual(result.status, 200);
  assert.ok(result.profile);
});

test("profile GET returns default profile when not consented", () => {
  const result = simulateProfileGet({
    auth: { user: { id: "user-123" } },
    orgId: "00000000-0000-0000-0000-000000000001",
    consented: false,
  });
  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(result.profile, DEFAULT_PROFILE);
  assert.strictEqual(result.consented, false);
});

test("profile GET returns 403 when user is not a member", () => {
  const result = simulateProfileGet({
    auth: { user: { id: "user-123" } },
    orgId: "00000000-0000-0000-0000-000000000001",
    consented: true,
    isMember: false,
  });
  assert.strictEqual(result.status, 403);
  assert.ok(result.error?.includes("Not a member"));
});

test("profile GET returns default profile when org not found", () => {
  const result = simulateProfileGet({
    auth: { user: { id: "user-123" } },
    orgId: "00000000-0000-0000-0000-000000000001",
    consented: true,
    isMember: true,
    orgExists: false,
  });
  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(result.profile, DEFAULT_PROFILE);
  assert.strictEqual(result.consented, true);
});

test("profile GET returns default profile when no ANTHROPIC_API_KEY", () => {
  const result = simulateProfileGet({
    auth: { user: { id: "user-123" } },
    orgId: "00000000-0000-0000-0000-000000000001",
    consented: true,
    isMember: true,
    orgExists: true,
    hasApiKey: false,
  });
  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(result.profile, DEFAULT_PROFILE);
  assert.strictEqual(result.consented, true);
});

test("profile GET returns LLM-generated profile on success", () => {
  const result = simulateProfileGet({
    auth: { user: { id: "user-123" } },
    orgId: "00000000-0000-0000-0000-000000000001",
    consented: true,
    isMember: true,
    orgExists: true,
    hasApiKey: true,
    llmResult: undefined, // Use mock profile
  });
  assert.strictEqual(result.status, 200);
  assert.ok(result.profile);
  assert.strictEqual(result.consented, true);
  assert.ok(result.profile.nav_order.length > 0);
  assert.ok(result.profile.dashboard_hints.show_recent_features);
});

test("profile GET returns default profile on LLM error (graceful degradation)", () => {
  const result = simulateProfileGet({
    auth: { user: { id: "user-123" } },
    orgId: "00000000-0000-0000-0000-000000000001",
    consented: true,
    isMember: true,
    orgExists: true,
    hasApiKey: true,
    llmResult: null, // Simulate LLM error
  });
  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(result.profile, DEFAULT_PROFILE);
  assert.strictEqual(result.consented, true);
});

test("profile GET returns custom LLM profile", () => {
  const customProfile: UIProfile = {
    nav_order: ["events", "workouts", "competition"],
    feature_highlights: ["workouts", "competition"],
    dashboard_hints: {
      show_recent_features: false,
      suggested_features: ["records"],
      preferred_time_label: "morning",
    },
  };

  const result = simulateProfileGet({
    auth: { user: { id: "user-123" } },
    orgId: "00000000-0000-0000-0000-000000000001",
    consented: true,
    isMember: true,
    orgExists: true,
    hasApiKey: true,
    llmResult: customProfile,
  });
  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(result.profile, customProfile);
  assert.strictEqual(result.consented, true);
});

test("profile GET includes consented field in all success responses (Issue 14)", () => {
  // Test multiple scenarios to ensure consented is always present

  // Scenario 1: Not consented
  const result1 = simulateProfileGet({
    auth: { user: { id: "user-123" } },
    orgId: "00000000-0000-0000-0000-000000000001",
    consented: false,
  });
  assert.strictEqual(result1.status, 200);
  assert.strictEqual(typeof result1.consented, "boolean");
  assert.strictEqual(result1.consented, false);

  // Scenario 2: Consented, org not found
  const result2 = simulateProfileGet({
    auth: { user: { id: "user-123" } },
    orgId: "00000000-0000-0000-0000-000000000001",
    consented: true,
    orgExists: false,
  });
  assert.strictEqual(result2.status, 200);
  assert.strictEqual(typeof result2.consented, "boolean");
  assert.strictEqual(result2.consented, true);

  // Scenario 3: Consented, no API key
  const result3 = simulateProfileGet({
    auth: { user: { id: "user-123" } },
    orgId: "00000000-0000-0000-0000-000000000001",
    consented: true,
    hasApiKey: false,
  });
  assert.strictEqual(result3.status, 200);
  assert.strictEqual(typeof result3.consented, "boolean");
  assert.strictEqual(result3.consented, true);

  // Scenario 4: Consented, LLM success
  const result4 = simulateProfileGet({
    auth: { user: { id: "user-123" } },
    orgId: "00000000-0000-0000-0000-000000000001",
    consented: true,
  });
  assert.strictEqual(result4.status, 200);
  assert.strictEqual(typeof result4.consented, "boolean");
  assert.strictEqual(result4.consented, true);
});

test("profile GET handles lowercase UUID", () => {
  const result = simulateProfileGet({
    auth: { user: { id: "user-123" } },
    orgId: "abcdef12-3456-7890-abcd-ef1234567890",
  });
  assert.strictEqual(result.status, 200);
  assert.ok(result.profile);
});

test("profile GET handles uppercase UUID", () => {
  const result = simulateProfileGet({
    auth: { user: { id: "user-123" } },
    orgId: "ABCDEF12-3456-7890-ABCD-EF1234567890",
  });
  assert.strictEqual(result.status, 200);
  assert.ok(result.profile);
});

test("profile GET handles mixed case UUID", () => {
  const result = simulateProfileGet({
    auth: { user: { id: "user-123" } },
    orgId: "AbCdEf12-3456-7890-aBcD-eF1234567890",
  });
  assert.strictEqual(result.status, 200);
  assert.ok(result.profile);
});

test("profile GET rejects malformed UUID - too short", () => {
  const result = simulateProfileGet({
    auth: { user: { id: "user-123" } },
    orgId: "12345678-1234-1234-1234",
  });
  assert.strictEqual(result.status, 400);
});

test("profile GET rejects malformed UUID - wrong format", () => {
  const result = simulateProfileGet({
    auth: { user: { id: "user-123" } },
    orgId: "12345678_1234_1234_1234_123456789abc",
  });
  assert.strictEqual(result.status, 400);
});
