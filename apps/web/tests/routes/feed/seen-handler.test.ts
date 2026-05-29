/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

const ORG_ID = "00000000-0000-4000-a000-000000000001";
const USER = { id: "00000000-0000-4000-a000-000000000099", email: "m@example.com" };

const { createFeedSeenPostHandler } = await import(
  "../../../src/app/api/feed/seen/handler.ts"
);

/**
 * Minimal Supabase stub: records the update payload + filters so we can assert
 * the timestamp write was scoped to the right user/org. `auth.getUser` and the
 * update outcome are configurable per-test.
 */
function createStub(opts: {
  user?: typeof USER | null;
  updateError?: { message: string } | null;
} = {}) {
  const calls: { update?: Record<string, unknown>; eq: Array<[string, unknown]> } = {
    eq: [],
  };

  const builder: any = {
    update(payload: Record<string, unknown>) {
      calls.update = payload;
      return builder;
    },
    eq(column: string, value: unknown) {
      calls.eq.push([column, value]);
      // Resolve on the terminal eq (loader chains two .eq calls).
      if (calls.eq.length >= 2) {
        return Promise.resolve({ error: opts.updateError ?? null });
      }
      return builder;
    },
  };

  return {
    calls,
    client: {
      auth: {
        getUser: async () => ({ data: { user: opts.user === undefined ? USER : opts.user } }),
      },
      from() {
        return builder;
      },
    },
  };
}

function postRequest(body: unknown): any {
  return new Request("http://localhost/api/feed/seen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  (globalThis as { __rateLimitStore?: Map<string, unknown> }).__rateLimitStore?.clear();
});

test("advances feed_last_seen_at for a member and returns ok", async () => {
  const stub = createStub();
  const handler = createFeedSeenPostHandler({
    createClient: async () => stub.client as any,
    getOrgMembership: async () => ({ role: "active_member" }),
    now: () => new Date("2026-06-01T00:00:00.000Z"),
  });

  const response = await handler(postRequest({ orgId: ORG_ID }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { ok: true } });
  assert.deepEqual(stub.calls.update, {
    feed_last_seen_at: "2026-06-01T00:00:00.000Z",
  });
  assert.deepEqual(stub.calls.eq, [
    ["user_id", USER.id],
    ["organization_id", ORG_ID],
  ]);
});

test("returns 401 when unauthenticated", async () => {
  const stub = createStub({ user: null });
  const handler = createFeedSeenPostHandler({
    createClient: async () => stub.client as any,
    getOrgMembership: async () => ({ role: "active_member" }),
  });

  const response = await handler(postRequest({ orgId: ORG_ID }));

  assert.equal(response.status, 401);
  assert.equal(stub.calls.update, undefined);
});

test("returns 403 when the user is not a member of the org", async () => {
  const stub = createStub();
  const handler = createFeedSeenPostHandler({
    createClient: async () => stub.client as any,
    getOrgMembership: async () => null,
  });

  const response = await handler(postRequest({ orgId: ORG_ID }));

  assert.equal(response.status, 403);
  assert.equal(stub.calls.update, undefined);
});

test("returns 400 for an invalid orgId", async () => {
  const stub = createStub();
  const handler = createFeedSeenPostHandler({
    createClient: async () => stub.client as any,
    getOrgMembership: async () => ({ role: "active_member" }),
  });

  const response = await handler(postRequest({ orgId: "not-a-uuid" }));

  assert.equal(response.status, 400);
  assert.equal(stub.calls.update, undefined);
});

test("returns 400 when the body is missing orgId", async () => {
  const stub = createStub();
  const handler = createFeedSeenPostHandler({
    createClient: async () => stub.client as any,
    getOrgMembership: async () => ({ role: "active_member" }),
  });

  const response = await handler(postRequest({}));

  assert.equal(response.status, 400);
});

test("returns 500 when the update fails", async () => {
  const stub = createStub({ updateError: { message: "db down" } });
  const handler = createFeedSeenPostHandler({
    createClient: async () => stub.client as any,
    getOrgMembership: async () => ({ role: "active_member" }),
  });

  const response = await handler(postRequest({ orgId: ORG_ID }));

  assert.equal(response.status, 500);
});
