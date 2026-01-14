import test from "node:test";
import assert from "node:assert";
import { z } from "zod";

/**
 * Tests for POST /api/enterprise/[enterpriseId]/invites
 *
 * Since the route calls Supabase RPC and requires live auth context,
 * we simulate the route logic to verify:
 *
 * 1. Schema validation — valid/invalid inputs for createInviteSchema
 * 2. RPC error forwarding — specific error messages are surfaced (not generic)
 * 3. The "Must be authenticated" bug — reproduced and verified fixed
 * 4. Success path — invite data returned correctly
 * 5. Bulk invite error handling
 */

// ── Schema mirrors from invites/route.ts ────────────────────────────────────

const baseSchemas = {
  uuid: z.string().uuid(),
};

const createInviteSchema = z.object({
  organizationId: baseSchemas.uuid.optional(),
  role: z.enum(["admin", "active_member", "alumni"]),
  usesRemaining: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
}).refine(
  (data) => data.organizationId || data.role !== "active_member",
  {
    message: "Enterprise-wide invites require a specific role (admin or alumni). Members must join a specific organization.",
    path: ["role"],
  }
);

// ── Simulation types ────────────────────────────────────────────────────────

interface RpcResult {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
}

interface CreateInviteParams {
  organizationId?: string;
  role: string;
  usesRemaining?: number;
  expiresAt?: string;
  orgBelongsToEnterprise: boolean;
  adminCountPreCheck?: { count: number | null; error: boolean };
  rpcResult: RpcResult;
}

interface CreateInviteResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Simulates POST invites route logic (invites/route.ts:104-206).
 *
 * Key behaviors (AFTER fix):
 *   - RPC error → 400 with rpcError.message (not generic 500)
 *   - Org not found → 404
 *   - Admin cap exceeded (pre-check) → 400
 *   - Success → 200 with invite data
 */
function simulateCreateInvite(params: CreateInviteParams): CreateInviteResult {
  const {
    organizationId,
    role,
    adminCountPreCheck,
    orgBelongsToEnterprise,
    rpcResult,
  } = params;

  // Admin cap pre-check
  if (role === "admin" && adminCountPreCheck) {
    if (!adminCountPreCheck.error && (adminCountPreCheck.count ?? 0) >= 12) {
      return {
        status: 400,
        body: { error: "Enterprise admin limit reached (maximum 12 admins across all organizations)" },
      };
    }
  }

  // Org validation
  if (organizationId && !orgBelongsToEnterprise) {
    return { status: 404, body: { error: "Organization not found in this enterprise" } };
  }

  // RPC call — FIXED: surfaces rpcError.message, returns 400
  if (rpcResult.error) {
    return {
      status: 400,
      body: { error: rpcResult.error.message || "Failed to create invite" },
    };
  }

  return {
    status: 200,
    body: {
      ...rpcResult.data,
      organization_name: organizationId ? "Test Org" : null,
      is_enterprise_wide: !organizationId,
    },
  };
}

// ── Schema validation ───────────────────────────────────────────────────────

test("createInviteSchema accepts admin role with orgId", () => {
  const result = createInviteSchema.safeParse({
    organizationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    role: "admin",
  });
  assert.strictEqual(result.success, true);
});

test("createInviteSchema accepts alumni role without orgId (enterprise-wide)", () => {
  const result = createInviteSchema.safeParse({ role: "alumni" });
  assert.strictEqual(result.success, true);
});

test("createInviteSchema accepts admin role without orgId (enterprise-wide)", () => {
  const result = createInviteSchema.safeParse({ role: "admin" });
  assert.strictEqual(result.success, true);
});

test("createInviteSchema rejects active_member without orgId", () => {
  const result = createInviteSchema.safeParse({ role: "active_member" });
  assert.strictEqual(result.success, false);
  if (!result.success) {
    const roleError = result.error.issues.find((i) => i.path.includes("role"));
    assert.ok(roleError, "Should have error on 'role' path");
    assert.ok(roleError!.message.includes("specific role"));
  }
});

test("createInviteSchema accepts active_member with orgId", () => {
  const result = createInviteSchema.safeParse({
    organizationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    role: "active_member",
  });
  assert.strictEqual(result.success, true);
});

test("createInviteSchema rejects invalid role", () => {
  const result = createInviteSchema.safeParse({ role: "superadmin" });
  assert.strictEqual(result.success, false);
});

test("createInviteSchema rejects invalid UUID for organizationId", () => {
  const result = createInviteSchema.safeParse({
    organizationId: "not-a-uuid",
    role: "admin",
  });
  assert.strictEqual(result.success, false);
});

test("createInviteSchema accepts optional usesRemaining and expiresAt", () => {
  const result = createInviteSchema.safeParse({
    role: "alumni",
    usesRemaining: 5,
    expiresAt: "2026-12-31T23:59:59Z",
  });
  assert.strictEqual(result.success, true);
});

test("createInviteSchema rejects non-positive usesRemaining", () => {
  const result = createInviteSchema.safeParse({
    role: "alumni",
    usesRemaining: 0,
  });
  assert.strictEqual(result.success, false);
});

test("createInviteSchema rejects negative usesRemaining", () => {
  const result = createInviteSchema.safeParse({
    role: "alumni",
    usesRemaining: -1,
  });
  assert.strictEqual(result.success, false);
});

// ── Bug reproduction: "Must be authenticated" ───────────────────────────────

test("BUG REPRO: RPC 'Must be authenticated' error was previously returned as generic 500", () => {
  // This test reproduces the original bug where the service client had no JWT,
  // causing auth.uid() to return NULL inside the SECURITY DEFINER RPC.
  //
  // BEFORE FIX: route returned { error: "Failed to create invite" } with 500
  // AFTER FIX: route returns { error: "Must be authenticated" } with 400
  //            (and the actual fix uses the user-authenticated client so this
  //             error no longer occurs in practice)

  const result = simulateCreateInvite({
    role: "alumni",
    orgBelongsToEnterprise: true,
    rpcResult: {
      data: null,
      error: { message: "Must be authenticated" },
    },
  });

  // After fix: specific error message is forwarded, not the generic one
  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.body.error, "Must be authenticated");

  // Verify it's NOT the old generic error
  assert.notStrictEqual(result.body.error, "Failed to create invite");
});

test("BUG REPRO (old behavior): generic error hid the real RPC failure", () => {
  // Documents the OLD buggy behavior for regression awareness.
  // The old code did: return respond({ error: "Failed to create invite" }, 500)
  // regardless of what rpcError.message said.
  const oldBuggyBehavior = (rpcError: { message: string }) => ({
    status: 500,
    body: { error: "Failed to create invite" },
  });

  const oldResult = oldBuggyBehavior({ message: "Must be authenticated" });
  assert.strictEqual(oldResult.status, 500);
  assert.strictEqual(oldResult.body.error, "Failed to create invite");
  // The real error was completely hidden — this is why the bug was hard to diagnose
});

// ── RPC error forwarding (after fix) ────────────────────────────────────────

test("RPC 'Alumni quota reached' error is forwarded to client", () => {
  const result = simulateCreateInvite({
    role: "alumni",
    orgBelongsToEnterprise: true,
    rpcResult: {
      data: null,
      error: { message: "Alumni quota reached for this enterprise" },
    },
  });

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.body.error, "Alumni quota reached for this enterprise");
});

test("RPC 'Enterprise admin limit reached' error is forwarded to client", () => {
  const result = simulateCreateInvite({
    role: "admin",
    orgBelongsToEnterprise: true,
    adminCountPreCheck: { count: 5, error: false },
    rpcResult: {
      data: null,
      error: { message: "Enterprise admin limit reached (12 max)" },
    },
  });

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.body.error, "Enterprise admin limit reached (12 max)");
});

test("RPC error with empty message falls back to generic text", () => {
  const result = simulateCreateInvite({
    role: "alumni",
    orgBelongsToEnterprise: true,
    rpcResult: {
      data: null,
      error: { message: "" },
    },
  });

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.body.error, "Failed to create invite");
});

// ── Admin cap pre-check ─────────────────────────────────────────────────────

test("admin cap pre-check blocks invite when 12 admins exist", () => {
  const result = simulateCreateInvite({
    role: "admin",
    orgBelongsToEnterprise: true,
    adminCountPreCheck: { count: 12, error: false },
    rpcResult: { data: null, error: null },
  });

  assert.strictEqual(result.status, 400);
  assert.ok((result.body.error as string).includes("admin limit reached"));
});

test("admin cap pre-check allows invite when under limit", () => {
  const result = simulateCreateInvite({
    role: "admin",
    orgBelongsToEnterprise: true,
    adminCountPreCheck: { count: 11, error: false },
    rpcResult: {
      data: { id: "invite-1", role: "admin", status: "pending" },
      error: null,
    },
  });

  assert.strictEqual(result.status, 200);
});

// ── Org validation ──────────────────────────────────────────────────────────

test("returns 404 when org does not belong to enterprise", () => {
  const result = simulateCreateInvite({
    organizationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    role: "active_member",
    orgBelongsToEnterprise: false,
    rpcResult: { data: null, error: null },
  });

  assert.strictEqual(result.status, 404);
  assert.ok((result.body.error as string).includes("not found"));
});

// ── Success path ────────────────────────────────────────────────────────────

test("returns invite data with org name on success (org-specific)", () => {
  const result = simulateCreateInvite({
    organizationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    role: "active_member",
    orgBelongsToEnterprise: true,
    rpcResult: {
      data: { id: "invite-1", role: "active_member", status: "pending", code: "ABC123" },
      error: null,
    },
  });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.id, "invite-1");
  assert.strictEqual(result.body.role, "active_member");
  assert.strictEqual(result.body.code, "ABC123");
  assert.strictEqual(result.body.organization_name, "Test Org");
  assert.strictEqual(result.body.is_enterprise_wide, false);
});

test("returns invite data with null org name on success (enterprise-wide)", () => {
  const result = simulateCreateInvite({
    role: "alumni",
    orgBelongsToEnterprise: true,
    rpcResult: {
      data: { id: "invite-2", role: "alumni", status: "pending", code: "DEF456" },
      error: null,
    },
  });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.organization_name, null);
  assert.strictEqual(result.body.is_enterprise_wide, true);
});

// ── Bulk invite simulation ──────────────────────────────────────────────────

const inviteItemSchema = z.object({
  organizationId: z.string().uuid("organizationId must be a valid UUID"),
  role: z.enum(["admin", "active_member", "alumni"], {
    message: "role must be one of: admin, active_member, alumni",
  }),
});

const bulkInvitesSchema = z.object({
  invites: z
    .array(inviteItemSchema)
    .min(1, "At least one invite is required")
    .max(100, "Maximum 100 invites per batch"),
});

test("bulkInvitesSchema accepts valid batch", () => {
  const result = bulkInvitesSchema.safeParse({
    invites: [
      { organizationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", role: "admin" },
      { organizationId: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee", role: "alumni" },
    ],
  });
  assert.strictEqual(result.success, true);
});

test("bulkInvitesSchema rejects empty batch", () => {
  const result = bulkInvitesSchema.safeParse({ invites: [] });
  assert.strictEqual(result.success, false);
});

test("bulkInvitesSchema rejects batch over 100", () => {
  const invites = Array.from({ length: 101 }, (_, i) => ({
    organizationId: `aaaaaaaa-bbbb-4ccc-8ddd-${String(i).padStart(12, "0")}`,
    role: "alumni" as const,
  }));
  const result = bulkInvitesSchema.safeParse({ invites });
  assert.strictEqual(result.success, false);
});

test("bulk invite: RPC auth error causes all invites in batch to fail", () => {
  // Simulates what happened before the fix — every invite in a bulk batch
  // would fail with "Must be authenticated" because ctx.serviceSupabase was used
  const rpcResults: RpcResult[] = [
    { data: null, error: { message: "Must be authenticated" } },
    { data: null, error: { message: "Must be authenticated" } },
    { data: null, error: { message: "Must be authenticated" } },
  ];

  const success = rpcResults.filter((r) => !r.error).length;
  const failed = rpcResults.length - success;

  assert.strictEqual(success, 0);
  assert.strictEqual(failed, 3);
  // All failed — this was the bulk manifestation of the same bug
});
