import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createSupabaseStub } from "../utils/supabaseStub.ts";
import { authorizeEventSync } from "../../src/lib/calendar/event-sync-authz.ts";

const ORG_A = "00000000-0000-0000-0000-00000000000a";
const ORG_B = "00000000-0000-0000-0000-00000000000b";
const ADMIN_A = "00000000-0000-0000-0000-0000000000a1";
const REVOKED_ADMIN_A = "00000000-0000-0000-0000-0000000000a2";
const MEMBER_A = "00000000-0000-0000-0000-0000000000a3";
const CREATOR_A = "00000000-0000-0000-0000-0000000000a4";
const EVENT_A = "11111111-1111-4111-8111-111111111111";
const EVENT_B = "22222222-2222-4222-8222-222222222222";

function makeClient() {
  const stub = createSupabaseStub();
  return { stub, client: stub as unknown as SupabaseClient<Database> };
}

function seedOrgARoles(stub: ReturnType<typeof createSupabaseStub>) {
  stub.seed("user_organization_roles", [
    { user_id: ADMIN_A, organization_id: ORG_A, role: "admin", status: "active" },
    { user_id: REVOKED_ADMIN_A, organization_id: ORG_A, role: "admin", status: "revoked" },
    { user_id: MEMBER_A, organization_id: ORG_A, role: "active_member", status: "active" },
    { user_id: CREATOR_A, organization_id: ORG_A, role: "active_member", status: "active" },
  ]);
}

test("authorizeEventSync: active admin gets ok", async () => {
  const { stub, client } = makeClient();
  seedOrgARoles(stub);
  stub.seed("events", [
    { id: EVENT_A, organization_id: ORG_A, created_by_user_id: CREATOR_A },
  ]);
  const result = await authorizeEventSync({
    client,
    userId: ADMIN_A,
    eventId: EVENT_A,
    organizationId: ORG_A,
  });
  assert.equal(result.ok, true);
});

test("authorizeEventSync: event creator gets ok even when not admin", async () => {
  const { stub, client } = makeClient();
  seedOrgARoles(stub);
  stub.seed("events", [
    { id: EVENT_A, organization_id: ORG_A, created_by_user_id: CREATOR_A },
  ]);
  const result = await authorizeEventSync({
    client,
    userId: CREATOR_A,
    eventId: EVENT_A,
    organizationId: ORG_A,
  });
  assert.equal(result.ok, true);
});

test("authorizeEventSync: revoked admin denied with 403", async () => {
  const { stub, client } = makeClient();
  seedOrgARoles(stub);
  stub.seed("events", [
    { id: EVENT_A, organization_id: ORG_A, created_by_user_id: CREATOR_A },
  ]);
  const result = await authorizeEventSync({
    client,
    userId: REVOKED_ADMIN_A,
    eventId: EVENT_A,
    organizationId: ORG_A,
  });
  assert.deepStrictEqual(result, { ok: false, status: 403, reason: "not_admin_or_creator" });
});

test("authorizeEventSync: non-admin non-creator member denied with 403", async () => {
  const { stub, client } = makeClient();
  seedOrgARoles(stub);
  stub.seed("events", [
    { id: EVENT_A, organization_id: ORG_A, created_by_user_id: CREATOR_A },
  ]);
  const result = await authorizeEventSync({
    client,
    userId: MEMBER_A,
    eventId: EVENT_A,
    organizationId: ORG_A,
  });
  assert.deepStrictEqual(result, { ok: false, status: 403, reason: "not_admin_or_creator" });
});

test("authorizeEventSync: cross-org event lookup returns 404 (no enumeration)", async () => {
  const { stub, client } = makeClient();
  seedOrgARoles(stub);
  // Event B belongs to org B; member of org A submits Event B's id with org A.
  stub.seed("events", [
    { id: EVENT_B, organization_id: ORG_B, created_by_user_id: "someone-else" },
  ]);
  const result = await authorizeEventSync({
    client,
    userId: ADMIN_A,
    eventId: EVENT_B,
    organizationId: ORG_A,
  });
  assert.deepStrictEqual(result, { ok: false, status: 404, reason: "event_not_found" });
});

test("authorizeEventSync: cross-org with correct org returns ok only when caller belongs to that org", async () => {
  // Sanity check: same event, queried against its actual org, denies a foreign user.
  const { stub, client } = makeClient();
  seedOrgARoles(stub);
  stub.seed("events", [
    { id: EVENT_B, organization_id: ORG_B, created_by_user_id: "someone-else" },
  ]);
  const result = await authorizeEventSync({
    client,
    userId: ADMIN_A,
    eventId: EVENT_B,
    organizationId: ORG_B,
  });
  // ADMIN_A is not an admin of ORG_B and not the creator => 403.
  assert.deepStrictEqual(result, { ok: false, status: 403, reason: "not_admin_or_creator" });
});

test("authorizeEventSync: missing event returns 404", async () => {
  const { client } = makeClient();
  const result = await authorizeEventSync({
    client,
    userId: ADMIN_A,
    eventId: EVENT_A,
    organizationId: ORG_A,
  });
  assert.deepStrictEqual(result, { ok: false, status: 404, reason: "event_not_found" });
});
