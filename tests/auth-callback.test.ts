import { describe, it } from "node:test";
import assert from "node:assert";
import { createHmac } from "crypto";

// Set up environment variables before tests
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.AGE_VALIDATION_SECRET = "test-secret-32-characters-long!!";
process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";

// Age validation helpers (inline to avoid module resolution issues)
type AgeBracket = "under_13" | "13_17" | "18_plus";

const TOKEN_EXPIRY_MS = 10 * 60 * 1000;
const VALID_AGE_BRACKETS: AgeBracket[] = ["under_13", "13_17", "18_plus"];

function getSecret(): string {
  return process.env.AGE_VALIDATION_SECRET!;
}

interface AgeValidationPayload {
  ageBracket: AgeBracket;
  isMinor: boolean;
  validatedAt: number;
  expiresAt: number;
}

interface AgeValidationTokenData extends AgeValidationPayload {
  hash: string;
}

function createAgeValidationToken(ageBracket: AgeBracket): string {
  const validatedAt = Date.now();
  const expiresAt = validatedAt + TOKEN_EXPIRY_MS;
  const isMinor = ageBracket !== "18_plus";
  const payload: AgeValidationPayload = { ageBracket, isMinor, validatedAt, expiresAt };
  const hash = createHmac("sha256", getSecret()).update(JSON.stringify(payload)).digest("hex");
  const tokenData: AgeValidationTokenData = { ...payload, hash };
  return Buffer.from(JSON.stringify(tokenData)).toString("base64");
}

function isValidAgeBracket(value: unknown): value is AgeBracket {
  return typeof value === "string" && VALID_AGE_BRACKETS.includes(value as AgeBracket);
}

interface AgeValidationResult {
  valid: boolean;
  ageBracket?: AgeBracket;
  isMinor?: boolean;
  error?: string;
}

function verifyAgeValidationToken(token: string): AgeValidationResult {
  try {
    const decoded: AgeValidationTokenData = JSON.parse(Buffer.from(token, "base64").toString("utf8"));
    const { ageBracket, isMinor, validatedAt, expiresAt, hash } = decoded;
    const derivedIsMinor = ageBracket !== "18_plus";
    if (Date.now() > expiresAt) return { valid: false, error: "Token expired" };
    const payload: AgeValidationPayload = { ageBracket, isMinor, validatedAt, expiresAt };
    const expectedHash = createHmac("sha256", getSecret()).update(JSON.stringify(payload)).digest("hex");
    if (hash !== expectedHash) return { valid: false, error: "Invalid signature" };
    if (isMinor !== derivedIsMinor) return { valid: false, error: "Invalid token data" };
    if (ageBracket === "under_13") return { valid: false, error: "Parental consent required" };
    return { valid: true, ageBracket, isMinor };
  } catch {
    return { valid: false, error: "Invalid token format" };
  }
}

/**
 * Simulates the auth callback route logic for testing.
 * This mirrors the behavior of src/app/auth/callback/route.ts
 */
interface MockSession {
  user: {
    id: string;
    user_metadata: Record<string, unknown>;
    created_at?: string;
  };
}

interface CallbackResult {
  redirect: string;
  success: boolean;
}

/**
 * CURRENT (BUGGY) implementation - blocks login for users without age data
 */
function handleAuthCallbackBuggy(
  requestUrl: URL,
  session: MockSession | null,
  siteUrl: string
): CallbackResult {
  if (!session) {
    return { redirect: `${siteUrl}/auth/error`, success: false };
  }

  const userMeta = session.user.user_metadata;
  const ageBracket = userMeta?.age_bracket as string | undefined;

  // Check if age_bracket exists in metadata
  if (!ageBracket) {
    // Check query params for OAuth flow
    const oauthAgeBracket = requestUrl.searchParams.get("age_bracket");
    const oauthAgeToken = requestUrl.searchParams.get("age_token");

    // BUG: This blocks login attempts that don't have age params!
    if (!oauthAgeToken) {
      return {
        redirect: `${siteUrl}/auth/signup?error=${encodeURIComponent("Age verification required. Please complete the signup process.")}`,
        success: false,
      };
    }

    if (!oauthAgeBracket) {
      return {
        redirect: `${siteUrl}/auth/signup?error=${encodeURIComponent("Age verification required. Please complete the signup process.")}`,
        success: false,
      };
    }

    // Validate age bracket value
    if (!isValidAgeBracket(oauthAgeBracket)) {
      return {
        redirect: `${siteUrl}/auth/error?message=${encodeURIComponent("Invalid age data")}`,
        success: false,
      };
    }

    const tokenResult = verifyAgeValidationToken(oauthAgeToken);
    if (!tokenResult.valid) {
      return {
        redirect: `${siteUrl}/auth/signup?error=${encodeURIComponent("Age verification expired. Please try again.")}`,
        success: false,
      };
    }

    if (tokenResult.ageBracket !== oauthAgeBracket) {
      return {
        redirect: `${siteUrl}/auth/error?message=${encodeURIComponent("Invalid age data")}`,
        success: false,
      };
    }

    if (tokenResult.ageBracket === "under_13") {
      return { redirect: `${siteUrl}/auth/parental-consent`, success: false };
    }
  } else {
    // Age bracket exists in user metadata
    if (!isValidAgeBracket(ageBracket)) {
      return {
        redirect: `${siteUrl}/auth/error?message=${encodeURIComponent("Invalid age data")}`,
        success: false,
      };
    }

    if (ageBracket === "under_13") {
      return { redirect: `${siteUrl}/auth/parental-consent`, success: false };
    }
  }

  // Success
  return { redirect: `${siteUrl}/app`, success: true };
}

/**
 * FIXED implementation - allows login for users without age data
 */
function handleAuthCallbackFixed(
  requestUrl: URL,
  session: MockSession | null,
  siteUrl: string
): CallbackResult {
  if (!session) {
    return { redirect: `${siteUrl}/auth/error`, success: false };
  }

  const userMeta = session.user.user_metadata;
  const ageBracket = userMeta?.age_bracket as string | undefined;

  // Check if this is a signup flow with age data in query params
  const oauthAgeBracket = requestUrl.searchParams.get("age_bracket");
  const oauthAgeToken = requestUrl.searchParams.get("age_token");
  const hasAgeQueryParams = oauthAgeBracket || oauthAgeToken;

  // Only validate age if:
  // 1. User has age_bracket in metadata (existing validated user), OR
  // 2. Age query params are present (new signup flow)
  if (ageBracket) {
    // User has age_bracket in metadata - validate it
    if (!isValidAgeBracket(ageBracket)) {
      return {
        redirect: `${siteUrl}/auth/error?message=${encodeURIComponent("Invalid age data")}`,
        success: false,
      };
    }

    if (ageBracket === "under_13") {
      return { redirect: `${siteUrl}/auth/parental-consent`, success: false };
    }
  } else if (hasAgeQueryParams) {
    // New signup flow with age data in query params - validate it
    if (!oauthAgeBracket) {
      return {
        redirect: `${siteUrl}/auth/signup?error=${encodeURIComponent("Age verification required. Please complete the signup process.")}`,
        success: false,
      };
    }

    if (!isValidAgeBracket(oauthAgeBracket)) {
      return {
        redirect: `${siteUrl}/auth/error?message=${encodeURIComponent("Invalid age data")}`,
        success: false,
      };
    }

    if (oauthAgeBracket === "under_13") {
      return { redirect: `${siteUrl}/auth/parental-consent`, success: false };
    }

    if (!oauthAgeToken) {
      return {
        redirect: `${siteUrl}/auth/signup?error=${encodeURIComponent("Age verification required. Please complete the signup process.")}`,
        success: false,
      };
    }

    const tokenResult = verifyAgeValidationToken(oauthAgeToken);
    if (!tokenResult.valid) {
      return {
        redirect: `${siteUrl}/auth/signup?error=${encodeURIComponent("Age verification expired. Please try again.")}`,
        success: false,
      };
    }

    if (tokenResult.ageBracket !== oauthAgeBracket) {
      return {
        redirect: `${siteUrl}/auth/error?message=${encodeURIComponent("Invalid age data")}`,
        success: false,
      };
    }

  } else {
    // No age data present - could be login or bypassed signup
    // Check if this is a brand new user (created within last 60 seconds)
    // to prevent age gate bypass via direct OAuth
    const createdAt = session.user.created_at;
    const isNewUser = createdAt && (Date.now() - new Date(createdAt).getTime()) < 60000;

    if (isNewUser) {
      return {
        redirect: `${siteUrl}/auth/signup?error=${encodeURIComponent("Age verification required. Please complete the signup process.")}`,
        success: false,
      };
    }
    // Pre-age-gate user login - allow through
  }

  // Success
  return { redirect: `${siteUrl}/app`, success: true };
}

const siteUrl = "http://localhost:3000";

describe("Auth Callback - Login vs Signup Age Validation", () => {
  describe("Bug reproduction: existing user login blocked", () => {
    it("BUGGY: existing user login (no age params, no age metadata) - incorrectly redirects to signup", () => {
      // User created before age gate - no age_bracket in metadata
      const session: MockSession = {
        user: {
          id: "existing-user-123",
          user_metadata: {
            full_name: "John Doe",
            // No age_bracket - pre-age-gate user
          },
        },
      };

      // Login callback - no age params in URL
      const requestUrl = new URL("http://localhost:3000/auth/callback?code=abc123");

      const result = handleAuthCallbackBuggy(requestUrl, session, siteUrl);

      // BUG: This should succeed but instead redirects to signup
      assert.strictEqual(result.success, false, "Bug: Login is incorrectly blocked");
      assert.ok(
        result.redirect.includes("/auth/signup?error="),
        "Bug: Redirects to signup with error"
      );
    });

    it("FIXED: existing user login (no age params, no age metadata) - allows through", () => {
      const session: MockSession = {
        user: {
          id: "existing-user-123",
          user_metadata: {
            full_name: "John Doe",
            // No age_bracket - pre-age-gate user
          },
          // Created long ago (not a new user)
          created_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
        },
      };

      const requestUrl = new URL("http://localhost:3000/auth/callback?code=abc123");

      const result = handleAuthCallbackFixed(requestUrl, session, siteUrl);

      // Fixed: Login should succeed
      assert.strictEqual(result.success, true, "Login should succeed for existing users");
      assert.strictEqual(result.redirect, `${siteUrl}/app`, "Should redirect to app");
    });
  });

  describe("Existing user with age data in metadata", () => {
    it("user with valid age_bracket in metadata - allows through", () => {
      const session: MockSession = {
        user: {
          id: "validated-user-456",
          user_metadata: {
            age_bracket: "18_plus",
            age_validation_token: "some-token",
          },
        },
      };

      const requestUrl = new URL("http://localhost:3000/auth/callback?code=abc123");

      const buggyResult = handleAuthCallbackBuggy(requestUrl, session, siteUrl);
      const fixedResult = handleAuthCallbackFixed(requestUrl, session, siteUrl);

      // Both should succeed for users with valid metadata
      assert.strictEqual(buggyResult.success, true);
      assert.strictEqual(fixedResult.success, true);
    });

    it("user with 13_17 age_bracket - allows through", () => {
      const session: MockSession = {
        user: {
          id: "minor-user-789",
          user_metadata: {
            age_bracket: "13_17",
          },
        },
      };

      const requestUrl = new URL("http://localhost:3000/auth/callback?code=abc123");

      const fixedResult = handleAuthCallbackFixed(requestUrl, session, siteUrl);

      assert.strictEqual(fixedResult.success, true);
      assert.strictEqual(fixedResult.redirect, `${siteUrl}/app`);
    });

    it("user with under_13 age_bracket - redirects to parental consent", () => {
      const session: MockSession = {
        user: {
          id: "child-user-101",
          user_metadata: {
            age_bracket: "under_13",
          },
        },
      };

      const requestUrl = new URL("http://localhost:3000/auth/callback?code=abc123");

      const fixedResult = handleAuthCallbackFixed(requestUrl, session, siteUrl);

      assert.strictEqual(fixedResult.success, false);
      assert.ok(fixedResult.redirect.includes("/auth/parental-consent"));
    });
  });

  describe("New signup with age query params", () => {
    it("signup with valid age params - allows through", () => {
      const session: MockSession = {
        user: {
          id: "new-user-111",
          user_metadata: {}, // No age data in metadata yet
        },
      };

      const ageToken = createAgeValidationToken("18_plus");
      const requestUrl = new URL(
        `http://localhost:3000/auth/callback?code=abc123&age_bracket=18_plus&age_token=${encodeURIComponent(ageToken)}`
      );

      const fixedResult = handleAuthCallbackFixed(requestUrl, session, siteUrl);

      assert.strictEqual(fixedResult.success, true);
      assert.strictEqual(fixedResult.redirect, `${siteUrl}/app`);
    });

    it("signup with missing age_token - redirects to signup with error", () => {
      const session: MockSession = {
        user: {
          id: "new-user-222",
          user_metadata: {},
        },
      };

      // Has age_bracket but missing age_token
      const requestUrl = new URL(
        "http://localhost:3000/auth/callback?code=abc123&age_bracket=18_plus"
      );

      const fixedResult = handleAuthCallbackFixed(requestUrl, session, siteUrl);

      assert.strictEqual(fixedResult.success, false);
      assert.ok(fixedResult.redirect.includes("/auth/signup?error="));
    });

    it("signup with missing age_bracket - redirects to signup with error", () => {
      const session: MockSession = {
        user: {
          id: "new-user-333",
          user_metadata: {},
        },
      };

      const ageToken = createAgeValidationToken("18_plus");
      // Has age_token but missing age_bracket
      const requestUrl = new URL(
        `http://localhost:3000/auth/callback?code=abc123&age_token=${encodeURIComponent(ageToken)}`
      );

      const fixedResult = handleAuthCallbackFixed(requestUrl, session, siteUrl);

      assert.strictEqual(fixedResult.success, false);
      assert.ok(fixedResult.redirect.includes("/auth/signup?error="));
    });

    it("signup with invalid age_bracket value - redirects to error", () => {
      const session: MockSession = {
        user: {
          id: "new-user-444",
          user_metadata: {},
        },
      };

      const ageToken = createAgeValidationToken("18_plus");
      const requestUrl = new URL(
        `http://localhost:3000/auth/callback?code=abc123&age_bracket=invalid_bracket&age_token=${encodeURIComponent(ageToken)}`
      );

      const fixedResult = handleAuthCallbackFixed(requestUrl, session, siteUrl);

      assert.strictEqual(fixedResult.success, false);
      assert.ok(fixedResult.redirect.includes("/auth/error"));
    });

    it("signup with mismatched age bracket in token - redirects to error", () => {
      const session: MockSession = {
        user: {
          id: "new-user-555",
          user_metadata: {},
        },
      };

      // Token says 13_17 but query param says 18_plus
      const ageToken = createAgeValidationToken("13_17");
      const requestUrl = new URL(
        `http://localhost:3000/auth/callback?code=abc123&age_bracket=18_plus&age_token=${encodeURIComponent(ageToken)}`
      );

      const fixedResult = handleAuthCallbackFixed(requestUrl, session, siteUrl);

      assert.strictEqual(fixedResult.success, false);
      assert.ok(fixedResult.redirect.includes("/auth/error"));
    });

    it("signup with under_13 age - redirects to parental consent", () => {
      const session: MockSession = {
        user: {
          id: "child-signup-666",
          user_metadata: {},
        },
      };

      const ageToken = createAgeValidationToken("under_13");
      const requestUrl = new URL(
        `http://localhost:3000/auth/callback?code=abc123&age_bracket=under_13&age_token=${encodeURIComponent(ageToken)}`
      );

      const fixedResult = handleAuthCallbackFixed(requestUrl, session, siteUrl);

      assert.strictEqual(fixedResult.success, false);
      assert.ok(fixedResult.redirect.includes("/auth/parental-consent"));
    });
  });

  describe("Edge cases", () => {
    it("no session - redirects to error", () => {
      const requestUrl = new URL("http://localhost:3000/auth/callback?code=abc123");

      const fixedResult = handleAuthCallbackFixed(requestUrl, null, siteUrl);

      assert.strictEqual(fixedResult.success, false);
      assert.strictEqual(fixedResult.redirect, `${siteUrl}/auth/error`);
    });

    it("user with invalid age_bracket in metadata - redirects to error", () => {
      const session: MockSession = {
        user: {
          id: "corrupt-user-777",
          user_metadata: {
            age_bracket: "invalid_value",
          },
        },
      };

      const requestUrl = new URL("http://localhost:3000/auth/callback?code=abc123");

      const fixedResult = handleAuthCallbackFixed(requestUrl, session, siteUrl);

      assert.strictEqual(fixedResult.success, false);
      assert.ok(fixedResult.redirect.includes("/auth/error"));
    });

    it("OAuth login for existing user (Google) - no age params, should succeed", () => {
      // Simulates: User signed up with Google OAuth before age gate
      // Now logging back in via Google OAuth - no age params in callback
      const session: MockSession = {
        user: {
          id: "google-user-888",
          user_metadata: {
            avatar_url: "https://example.com/avatar.jpg",
            email: "user@gmail.com",
            full_name: "Google User",
            // No age_bracket - pre-age-gate OAuth user
          },
          // Created long ago
          created_at: new Date(Date.now() - 86400000 * 30).toISOString(), // 30 days ago
        },
      };

      const requestUrl = new URL("http://localhost:3000/auth/callback?code=google_auth_code");

      const buggyResult = handleAuthCallbackBuggy(requestUrl, session, siteUrl);
      const fixedResult = handleAuthCallbackFixed(requestUrl, session, siteUrl);

      // Bug: Existing OAuth user blocked
      assert.strictEqual(buggyResult.success, false, "Bug: OAuth login blocked");

      // Fixed: Should allow through
      assert.strictEqual(fixedResult.success, true, "OAuth login should succeed");
      assert.strictEqual(fixedResult.redirect, `${siteUrl}/app`);
    });

    it("Magic link login for existing user - should succeed", () => {
      const session: MockSession = {
        user: {
          id: "magic-link-user-999",
          user_metadata: {
            email: "user@example.com",
            // No age_bracket - pre-age-gate user
          },
          // Created long ago
          created_at: new Date(Date.now() - 86400000 * 7).toISOString(), // 7 days ago
        },
      };

      const requestUrl = new URL("http://localhost:3000/auth/callback?code=magic_link_code");

      const fixedResult = handleAuthCallbackFixed(requestUrl, session, siteUrl);

      assert.strictEqual(fixedResult.success, true);
      assert.strictEqual(fixedResult.redirect, `${siteUrl}/app`);
    });
  });

  describe("Security: Age gate bypass prevention", () => {
    it("SECURITY: brand new user without age params - blocks signup bypass attempt", () => {
      // Simulates: Malicious user tries to bypass age gate by going directly to OAuth
      // without completing the age gate flow
      const session: MockSession = {
        user: {
          id: "bypass-attempt-111",
          user_metadata: {
            // No age_bracket - trying to bypass
            email: "attacker@example.com",
          },
          // Just created (within 60 seconds)
          created_at: new Date(Date.now() - 5000).toISOString(), // 5 seconds ago
        },
      };

      const requestUrl = new URL("http://localhost:3000/auth/callback?code=oauth_code");

      const fixedResult = handleAuthCallbackFixed(requestUrl, session, siteUrl);

      // Should block new user without age data
      assert.strictEqual(fixedResult.success, false, "New user should be blocked without age validation");
      assert.ok(
        fixedResult.redirect.includes("/auth/signup?error="),
        "Should redirect to signup with age verification error"
      );
    });

    it("SECURITY: user created 61 seconds ago without age params - allowed (edge of window)", () => {
      // User created just outside the 60-second window - treated as existing user
      const session: MockSession = {
        user: {
          id: "edge-case-222",
          user_metadata: {
            email: "user@example.com",
          },
          // Created 61 seconds ago (just outside window)
          created_at: new Date(Date.now() - 61000).toISOString(),
        },
      };

      const requestUrl = new URL("http://localhost:3000/auth/callback?code=oauth_code");

      const fixedResult = handleAuthCallbackFixed(requestUrl, session, siteUrl);

      // Should allow through as not a "new" user
      assert.strictEqual(fixedResult.success, true);
      assert.strictEqual(fixedResult.redirect, `${siteUrl}/app`);
    });

    it("SECURITY: user without created_at timestamp - allowed (defensive, existing user)", () => {
      // Edge case: if created_at is missing, assume existing user (defensive)
      const session: MockSession = {
        user: {
          id: "no-timestamp-333",
          user_metadata: {
            email: "user@example.com",
          },
          // No created_at
        },
      };

      const requestUrl = new URL("http://localhost:3000/auth/callback?code=oauth_code");

      const fixedResult = handleAuthCallbackFixed(requestUrl, session, siteUrl);

      // Should allow through when no timestamp (assumes existing user)
      assert.strictEqual(fixedResult.success, true);
      assert.strictEqual(fixedResult.redirect, `${siteUrl}/app`);
    });
  });
});
