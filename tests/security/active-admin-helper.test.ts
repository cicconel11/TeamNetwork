import test from "node:test";
import assert from "node:assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createSupabaseStub } from "../utils/supabaseStub.ts";
import { getActiveAdminMembership } from "../../src/lib/auth/require-active-admin.ts";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-0000000000aa";

function buildClient() {
  const stub = createSupabaseStub();
  return { stub, client: stub as unknown as SupabaseClient<Database> };
}

test("active admin returns ok", async () => {
  const { stub, client } = buildClient();
  stub.seed("user_organization_roles", [
    { user_id: USER_ID, organization_id: ORG_ID, role: "admin", status: "active" },
  ]);
  const result = await getActiveAdminMembership(client, USER_ID, ORG_ID);
  assert.deepStrictEqual(result, { ok: true });
});

test("revoked admin returns inactive", async () => {
  const { stub, client } = buildClient();
  stub.seed("user_organization_roles", [
    { user_id: USER_ID, organization_id: ORG_ID, role: "admin", status: "revoked" },
  ]);
  const result = await getActiveAdminMembership(client, USER_ID, ORG_ID);
  assert.deepStrictEqual(result, { ok: false, reason: "inactive" });
});

test("pending admin returns inactive", async () => {
  const { stub, client } = buildClient();
  stub.seed("user_organization_roles", [
    { user_id: USER_ID, organization_id: ORG_ID, role: "admin", status: "pending" },
  ]);
  const result = await getActiveAdminMembership(client, USER_ID, ORG_ID);
  assert.deepStrictEqual(result, { ok: false, reason: "inactive" });
});

test("active non-admin returns not_admin", async () => {
  for (const role of ["active_member", "alumni", "parent"] as const) {
    const { stub, client } = buildClient();
    stub.seed("user_organization_roles", [
      { user_id: USER_ID, organization_id: ORG_ID, role, status: "active" },
    ]);
    const result = await getActiveAdminMembership(client, USER_ID, ORG_ID);
    assert.deepStrictEqual(result, { ok: false, reason: "not_admin" }, `role=${role}`);
  }
});

test("missing row returns missing", async () => {
  const { client } = buildClient();
  const result = await getActiveAdminMembership(client, USER_ID, ORG_ID);
  assert.deepStrictEqual(result, { ok: false, reason: "missing" });
});

test("DB error returns error", async () => {
  const { stub, client } = buildClient();
  stub.simulateError("user_organization_roles", { code: "500", message: "boom" });
  const result = await getActiveAdminMembership(client, USER_ID, ORG_ID);
  assert.deepStrictEqual(result, { ok: false, reason: "error" });
});

test("query scoped to user_id and organization_id (other org's admin row ignored)", async () => {
  const { stub, client } = buildClient();
  stub.seed("user_organization_roles", [
    { user_id: USER_ID, organization_id: "11111111-1111-1111-1111-111111111111", role: "admin", status: "active" },
    { user_id: USER_ID, organization_id: ORG_ID, role: "active_member", status: "active" },
  ]);
  const result = await getActiveAdminMembership(client, USER_ID, ORG_ID);
  assert.deepStrictEqual(result, { ok: false, reason: "not_admin" });
});
