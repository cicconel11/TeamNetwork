import test from "node:test";
import assert from "node:assert";
import { z } from "zod";

const createInviteSchema = z.object({
  role: z.enum(["admin", "active_member", "alumni", "parent"]),
  uses: z.number().int().positive().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
});

interface RpcResult {
  data: Record<string, unknown> | null;
  error: { message?: string } | null;
}

interface CreateInviteRequest {
  userId: string | null;
  role: "admin" | "active_member" | "alumni" | "parent" | null;
  body: unknown;
  rpcResult?: RpcResult;
}

interface CreateInviteResult {
  status: number;
  body: Record<string, unknown>;
}

function simulateCreateInvite(req: CreateInviteRequest): CreateInviteResult {
  if (!req.userId) {
    return { status: 401, body: { error: "Unauthorized" } };
  }

  if (req.role !== "admin") {
    return { status: 403, body: { error: "Forbidden" } };
  }

  const parsed = createInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    return { status: 400, body: { error: "Invalid request body" } };
  }

  if (req.rpcResult?.error) {
    return {
      status: 400,
      body: { error: req.rpcResult.error.message || "Failed to create invite" },
    };
  }

  if (!req.rpcResult?.data) {
    return { status: 400, body: { error: "Failed to create invite" } };
  }

  return { status: 200, body: { invite: req.rpcResult.data } };
}

test("createInviteSchema accepts alumni invite payload", () => {
  const result = createInviteSchema.safeParse({
    role: "alumni",
    uses: 5,
    expiresAt: "2026-03-27T00:00:00.000Z",
  });

  assert.strictEqual(result.success, true);
});

test("createInviteSchema accepts parent invite payload with unlimited uses", () => {
  const result = createInviteSchema.safeParse({
    role: "parent",
    uses: null,
    expiresAt: "2026-03-27T00:00:00.000Z",
  });

  assert.strictEqual(result.success, true);
});

test("createInviteSchema accepts null uses and null expiry", () => {
  const result = createInviteSchema.safeParse({
    role: "active_member",
    uses: null,
    expiresAt: null,
  });

  assert.strictEqual(result.success, true);
});

test("createInviteSchema rejects invalid role", () => {
  const result = createInviteSchema.safeParse({
    role: "superadmin",
  });

  assert.strictEqual(result.success, false);
});

test("route requires authentication", () => {
  const result = simulateCreateInvite({
    userId: null,
    role: null,
    body: { role: "alumni" },
  });

  assert.strictEqual(result.status, 401);
  assert.strictEqual(result.body.error, "Unauthorized");
});

test("route requires admin role", () => {
  const result = simulateCreateInvite({
    userId: "user-1",
    role: "active_member",
    body: { role: "alumni" },
  });

  assert.strictEqual(result.status, 403);
  assert.strictEqual(result.body.error, "Forbidden");
});

test("route forwards alumni quota RPC errors to the client", () => {
  const result = simulateCreateInvite({
    userId: "user-1",
    role: "admin",
    body: { role: "alumni", uses: null, expiresAt: "2026-03-27T00:00:00.000Z" },
    rpcResult: {
      data: null,
      error: {
        message: "Alumni quota reached for this plan. Upgrade your subscription to add more alumni.",
      },
    },
  });

  assert.strictEqual(result.status, 400);
  assert.strictEqual(
    result.body.error,
    "Alumni quota reached for this plan. Upgrade your subscription to add more alumni.",
  );
});

test("route falls back to generic error when RPC error message is empty", () => {
  const result = simulateCreateInvite({
    userId: "user-1",
    role: "admin",
    body: { role: "alumni" },
    rpcResult: {
      data: null,
      error: { message: "" },
    },
  });

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.body.error, "Failed to create invite");
});

test("route returns invite payload on success", () => {
  const result = simulateCreateInvite({
    userId: "user-1",
    role: "admin",
    body: { role: "alumni", uses: 1 },
    rpcResult: {
      data: {
        id: "invite-1",
        code: "ABC12345",
        role: "alumni",
      },
      error: null,
    },
  });

  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(result.body.invite, {
    id: "invite-1",
    code: "ABC12345",
    role: "alumni",
  });
});

test("route returns reusable parent invite payload on success", () => {
  const result = simulateCreateInvite({
    userId: "user-1",
    role: "admin",
    body: { role: "parent", uses: null },
    rpcResult: {
      data: {
        id: "invite-parent-1",
        code: "PARENT01",
        role: "parent",
        uses_remaining: null,
      },
      error: null,
    },
  });

  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(result.body.invite, {
    id: "invite-parent-1",
    code: "PARENT01",
    role: "parent",
    uses_remaining: null,
  });
});
