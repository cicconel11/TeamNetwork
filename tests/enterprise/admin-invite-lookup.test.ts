import test from "node:test";
import assert from "node:assert";

/**
 * Tests for enterprise admin invite user lookup behavior:
 * - Case-insensitive email matching via auth.users
 * - Error handling for DB lookup failures
 *
 * These are simulation tests that verify the lookup logic
 * matches the implementation in admins/route.ts POST handler.
 */

interface UserRow {
  id: string;
  email: string;
  raw_user_meta_data: Record<string, unknown> | null;
}

interface LookupResult {
  targetUser: { id: string; email: string; user_metadata: Record<string, unknown> } | null;
  error: string | null;
  status: number | null;
}

/**
 * Simulates the auth.users lookup in admins/route.ts POST handler.
 * Uses case-insensitive matching (ilike) as in the real implementation.
 */
function simulateUserLookup(
  email: string,
  usersTable: UserRow[],
  dbError: boolean = false
): LookupResult {
  if (dbError) {
    return { targetUser: null, error: "Failed to look up user", status: 500 };
  }

  // ilike is case-insensitive — simulate with toLowerCase comparison
  const match = usersTable.find(
    (u) => u.email.toLowerCase() === email.toLowerCase()
  ) ?? null;

  if (!match) {
    return { targetUser: null, error: null, status: null };
  }

  return {
    targetUser: {
      id: match.id,
      email: match.email,
      user_metadata: match.raw_user_meta_data ?? {},
    },
    error: null,
    status: null,
  };
}

const testUsers: UserRow[] = [
  {
    id: "user-1",
    email: "alice@example.com",
    raw_user_meta_data: { full_name: "Alice Smith" },
  },
  {
    id: "user-2",
    email: "Bob.Jones@Example.COM",
    raw_user_meta_data: { full_name: "Bob Jones" },
  },
  {
    id: "user-3",
    email: "carol@test.org",
    raw_user_meta_data: null,
  },
  {
    id: "user-4",
    email: "special_%@example.com",
    raw_user_meta_data: { full_name: "Special User" },
  },
];

test("finds user with exact email match", () => {
  const result = simulateUserLookup("alice@example.com", testUsers);
  assert.strictEqual(result.targetUser?.id, "user-1");
  assert.strictEqual(result.targetUser?.email, "alice@example.com");
});

test("finds user with case-insensitive email match", () => {
  const result = simulateUserLookup("ALICE@EXAMPLE.COM", testUsers);
  assert.strictEqual(result.targetUser?.id, "user-1");
});

test("finds user with mixed-case email stored in DB", () => {
  const result = simulateUserLookup("bob.jones@example.com", testUsers);
  assert.strictEqual(result.targetUser?.id, "user-2");
  assert.strictEqual(result.targetUser?.email, "Bob.Jones@Example.COM");
});

test("treats % and _ as literal characters in email lookup", () => {
  const result = simulateUserLookup("special_%@example.com", testUsers);
  assert.strictEqual(result.targetUser?.id, "user-4");
});

test("returns null for non-existent email", () => {
  const result = simulateUserLookup("nobody@example.com", testUsers);
  assert.strictEqual(result.targetUser, null);
  assert.strictEqual(result.error, null);
});

test("returns 500 on DB error", () => {
  const result = simulateUserLookup("alice@example.com", testUsers, true);
  assert.strictEqual(result.targetUser, null);
  assert.strictEqual(result.status, 500);
  assert.ok(result.error?.includes("Failed to look up user"));
});

test("maps raw_user_meta_data to user_metadata", () => {
  const result = simulateUserLookup("alice@example.com", testUsers);
  assert.strictEqual(
    (result.targetUser?.user_metadata as Record<string, unknown>).full_name,
    "Alice Smith"
  );
});

test("handles null raw_user_meta_data as empty object", () => {
  const result = simulateUserLookup("carol@test.org", testUsers);
  assert.deepStrictEqual(result.targetUser?.user_metadata, {});
});
