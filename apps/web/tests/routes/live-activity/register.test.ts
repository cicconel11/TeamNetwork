import { describe, it } from "node:test";
import assert from "node:assert";

/**
 * Route simulation tests for /api/live-activity/register
 *
 * Mirrors `apps/web/src/app/api/live-activity/register/route.ts` decision
 * logic: 401 unauth, 403 not-attending, 403 org mismatch, 200 success.
 *
 * Pure logic — keeps the test fast and avoids needing a live Supabase.
 */

interface RegisterInput {
  authedUserId: string | null;
  body: {
    activityId: string;
    eventId: string;
    organizationId: string;
    deviceId: string;
    pushToken: string;
    endsAt: string;
  } | null;
  rsvp: { status: string; organization_id: string } | null;
}

interface RegisterOutput {
  status: number;
  body: unknown;
}

function simulateRegister(input: RegisterInput): RegisterOutput {
  if (!input.authedUserId) {
    return { status: 401, body: { error: "Unauthorized" } };
  }
  if (!input.body) {
    return { status: 400, body: { error: "Invalid request body" } };
  }
  if (!input.rsvp || input.rsvp.status !== "attending") {
    return { status: 403, body: { error: "Not attending this event" } };
  }
  if (input.rsvp.organization_id !== input.body.organizationId) {
    return { status: 403, body: { error: "Organization mismatch" } };
  }
  return { status: 200, body: { success: true } };
}

describe("/api/live-activity/register", () => {
  const baseBody = {
    activityId: "act-1",
    eventId: "00000000-0000-0000-0000-0000000000aa",
    organizationId: "00000000-0000-0000-0000-0000000000bb",
    deviceId: "dev-1",
    pushToken: "ab".repeat(32),
    endsAt: new Date().toISOString(),
  };

  it("rejects unauthenticated callers with 401", () => {
    const result = simulateRegister({
      authedUserId: null,
      body: baseBody,
      rsvp: { status: "attending", organization_id: baseBody.organizationId },
    });
    assert.strictEqual(result.status, 401);
  });

  it("rejects when caller has no attending RSVP", () => {
    const result = simulateRegister({
      authedUserId: "user-1",
      body: baseBody,
      rsvp: null,
    });
    assert.strictEqual(result.status, 403);
    assert.deepStrictEqual(result.body, { error: "Not attending this event" });
  });

  it("rejects when RSVP status is not attending", () => {
    const result = simulateRegister({
      authedUserId: "user-1",
      body: baseBody,
      rsvp: { status: "maybe", organization_id: baseBody.organizationId },
    });
    assert.strictEqual(result.status, 403);
  });

  it("rejects when organizationId does not match the RSVP", () => {
    const result = simulateRegister({
      authedUserId: "user-1",
      body: baseBody,
      rsvp: {
        status: "attending",
        organization_id: "00000000-0000-0000-0000-0000000000cc",
      },
    });
    assert.strictEqual(result.status, 403);
    assert.deepStrictEqual(result.body, { error: "Organization mismatch" });
  });

  it("returns 200 when authed + attending + org match", () => {
    const result = simulateRegister({
      authedUserId: "user-1",
      body: baseBody,
      rsvp: { status: "attending", organization_id: baseBody.organizationId },
    });
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(result.body, { success: true });
  });
});
