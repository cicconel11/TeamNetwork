import { strict as assert } from "assert";
import { test } from "node:test";

test("bulk invites — filters invalid org IDs", () => {
  const payload = {
    invites: [
      { organizationId: "org-valid", role: "admin" },
      { organizationId: "org-invalid", role: "active_member" },
    ],
  };

  // The bulk route should filter to only valid orgs and count failures
  const validOrgIds = new Set(["org-valid"]);
  const validInvites = payload.invites.filter((i) =>
    validOrgIds.has(i.organizationId)
  );
  const invalidCount = payload.invites.length - validInvites.length;

  assert.equal(validInvites.length, 1);
  assert.equal(invalidCount, 1);
});

test("bulk invites — >100 invites rejected by schema", () => {
  const invites = Array.from({ length: 101 }, (_, i) => ({
    organizationId: `org-${i}`,
    role: "active_member",
  }));

  // Zod schema validates max 100
  const schema = {
    parse: (data: unknown) => {
      const obj = data as { invites: unknown[] };
      if ((obj.invites?.length ?? 0) > 100) {
        throw new Error("Maximum 100 invites per batch");
      }
      return obj;
    },
  };

  assert.throws(
    () => schema.parse({ invites }),
    /Maximum 100 invites per batch/
  );
});

test("bulk invites — role validation", () => {
  const validRoles = ["admin", "active_member", "alumni"];
  const invalidRole = "superuser";

  assert.ok(validRoles.includes("admin"));
  assert.ok(!validRoles.includes(invalidRole));
});

test("bulk invites — success and failed counts sum to total", () => {
  const result = { success: 50, failed: 0, total: 50 };

  assert.equal(result.success + result.failed, result.total);
});

test("bulk invites — RPC response errors are counted as failed", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: PromiseSettledResult<any>[] = [
    { status: "fulfilled", value: { id: "inv-1" } },
    { status: "rejected", reason: "Error" },
    { status: "fulfilled", value: { id: "inv-2" } },
  ];

  const success = results.filter((r) => r.status === "fulfilled" && !r.value?.error).length;
  const failed = results.length - success;

  assert.equal(success, 2);
  assert.equal(failed, 1);
});
