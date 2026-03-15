import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

process.env.NEXT_PUBLIC_APP_URL = "https://example.com";

import {
  LINKEDIN_STATE_COOKIE,
  LINKEDIN_STATE_MAX_AGE_SECONDS,
  createLinkedInOAuthState,
  parseLinkedInOAuthState,
  isLinkedInOAuthStateExpired,
  validateLinkedInOAuthState,
} from "@/lib/linkedin/state";

const USER_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

describe("linkedin oauth state", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
  });

  it("creates an opaque state value and cookie metadata", () => {
    const result = createLinkedInOAuthState({
      userId: USER_ID,
      redirectPath: "/settings/linkedin",
      now: 1_700_000_000_000,
    });

    assert.equal(typeof result.state, "string");
    assert.ok(result.state.length > 20);
    assert.equal(result.state, result.payload.nonce);
    assert.equal(parseLinkedInOAuthState(result.state), null);
    assert.equal(result.cookie.name, LINKEDIN_STATE_COOKIE);
    assert.notEqual(result.cookie.value, result.state);
    assert.equal(result.cookie.options.httpOnly, true);
    assert.equal(result.cookie.options.sameSite, "lax");
    assert.equal(result.cookie.options.maxAge, LINKEDIN_STATE_MAX_AGE_SECONDS);
    assert.equal(result.cookie.options.path, "/");
    assert.equal(result.cookie.options.secure, false);
  });

  it("round-trips the encoded payload", () => {
    const result = createLinkedInOAuthState({
      userId: USER_ID,
      redirectPath: "/settings/connected-accounts",
      now: 1_700_000_000_000,
    });

    const parsed = parseLinkedInOAuthState(result.cookie.value);
    assert.ok(parsed);
    assert.equal(parsed?.userId, USER_ID);
    assert.equal(parsed?.redirectPath, "/settings/connected-accounts");
    assert.equal(parsed?.timestamp, 1_700_000_000_000);
  });

  it("rejects invalid payloads", () => {
    assert.equal(parseLinkedInOAuthState("not-base64"), null);
  });

  it("detects expired state values", () => {
    const expired = createLinkedInOAuthState({
      userId: USER_ID,
      redirectPath: "/settings/linkedin",
      now: 1_700_000_000_000,
    });

    const parsed = parseLinkedInOAuthState(expired.cookie.value);
    assert.ok(parsed);
    assert.equal(
      isLinkedInOAuthStateExpired(parsed!, {
        now: 1_700_000_000_000 + (LINKEDIN_STATE_MAX_AGE_SECONDS + 1) * 1000,
      }),
      true,
    );
  });

  it("rejects mismatched query and cookie state values", () => {
    const first = createLinkedInOAuthState({
      userId: USER_ID,
      redirectPath: "/settings/linkedin",
      now: 1_700_000_000_000,
    });
    const second = createLinkedInOAuthState({
      userId: USER_ID,
      redirectPath: "/settings/linkedin",
      now: 1_700_000_000_000,
    });

    const result = validateLinkedInOAuthState({
      stateFromQuery: first.state,
      stateFromCookie: second.cookie.value,
      defaultRedirectPath: "/settings/linkedin",
      now: 1_700_000_000_000,
    });

    assert.deepEqual(result, {
      ok: false,
      error: "state_mismatch",
      redirectPath: "/settings/linkedin",
    });
  });

  it("rejects a cookie-bound state for a different authenticated user", () => {
    const state = createLinkedInOAuthState({
      userId: USER_ID,
      redirectPath: "/settings/linkedin",
      now: 1_700_000_000_000,
    });

    const result = validateLinkedInOAuthState({
      stateFromQuery: state.state,
      stateFromCookie: state.cookie.value,
      defaultRedirectPath: "/settings/linkedin",
      currentUserId: "b1b2c3d4-e5f6-7890-abcd-ef1234567890",
      now: 1_700_000_000_000,
    });

    assert.deepEqual(result, {
      ok: false,
      error: "state_mismatch",
      redirectPath: "/settings/linkedin",
    });
  });
});
