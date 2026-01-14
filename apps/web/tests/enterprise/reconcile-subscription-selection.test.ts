import test from "node:test";
import assert from "node:assert";
import {
  pickMostRecentRecoverableAttempt,
  resolveRecoverableAttemptLookup,
  type RecoverableAttempt,
} from "../../src/lib/payments/reconcile-helpers.ts";

function attempt(overrides: Partial<RecoverableAttempt>): RecoverableAttempt {
  return {
    id: "attempt_default",
    stripe_checkout_session_id: "cs_default",
    status: "succeeded",
    organization_id: "org-1",
    metadata: null,
    created_at: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

test("pickMostRecentRecoverableAttempt picks newer metadata pending_org_id attempt over older organization_id attempt", () => {
  const byOrgId = [
    attempt({ id: "org_old", created_at: "2026-01-01T00:00:00.000Z" }),
  ];
  const byPendingOrgId = [
    attempt({ id: "meta_new", organization_id: null, created_at: "2026-02-01T00:00:00.000Z" }),
  ];

  const selected = pickMostRecentRecoverableAttempt({ byOrgId, byPendingOrgId });

  assert.strictEqual(selected?.id, "meta_new");
});

test("pickMostRecentRecoverableAttempt uses deterministic tie break: organization_id match first", () => {
  const byOrgId = [
    attempt({ id: "org_tie", created_at: "2026-02-01T00:00:00.000Z" }),
  ];
  const byPendingOrgId = [
    attempt({ id: "meta_tie", organization_id: null, created_at: "2026-02-01T00:00:00.000Z" }),
  ];

  const selected = pickMostRecentRecoverableAttempt({ byOrgId, byPendingOrgId });

  assert.strictEqual(selected?.id, "org_tie");
});

test("pickMostRecentRecoverableAttempt keeps deterministic ordering for same source and timestamp", () => {
  const byOrgId = [
    attempt({ id: "b", created_at: "2026-02-01T00:00:00.000Z" }),
    attempt({ id: "a", created_at: "2026-02-01T00:00:00.000Z" }),
  ];

  const selected = pickMostRecentRecoverableAttempt({ byOrgId, byPendingOrgId: [] });

  assert.strictEqual(selected?.id, "a");
});

test("pickMostRecentRecoverableAttempt treats invalid created_at as oldest", () => {
  const byOrgId = [attempt({ id: "org_invalid", created_at: "not-a-date" })];
  const byPendingOrgId = [attempt({ id: "meta_valid", created_at: "2026-03-01T00:00:00.000Z" })];

  const selected = pickMostRecentRecoverableAttempt({ byOrgId, byPendingOrgId });

  assert.strictEqual(selected?.id, "meta_valid");
});

test("resolveRecoverableAttemptLookup fails closed when organization_id query errors", () => {
  const result = resolveRecoverableAttemptLookup({
    byOrgId: { data: null, error: { code: "XX001", message: "db blew up" } },
    byPendingOrgId: { data: [attempt({ id: "meta_new" })], error: null },
  });

  assert.strictEqual(result.error, "Failed to query payment attempts for reconciliation.");
  assert.strictEqual(result.attempt, null);
});

test("resolveRecoverableAttemptLookup fails closed when metadata pending_org_id query errors", () => {
  const result = resolveRecoverableAttemptLookup({
    byOrgId: { data: [attempt({ id: "org_new" })], error: null },
    byPendingOrgId: { data: null, error: { code: "XX001", message: "db blew up" } },
  });

  assert.strictEqual(result.error, "Failed to query payment attempts for reconciliation.");
  assert.strictEqual(result.attempt, null);
});
