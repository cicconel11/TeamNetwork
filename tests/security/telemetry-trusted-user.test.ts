import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { resolveTrustedUserId } from "../../src/lib/telemetry/trusted-user.ts";

type AuthGetUser = () => Promise<{ data: { user: { id: string } | null } }>;

function buildAuthClient(getUser: AuthGetUser): SupabaseClient<Database> {
  return { auth: { getUser } } as unknown as SupabaseClient<Database>;
}

test("resolveTrustedUserId returns null for anonymous session", async () => {
  const client = buildAuthClient(async () => ({ data: { user: null } }));
  const id = await resolveTrustedUserId(client);
  assert.equal(id, null);
});

test("resolveTrustedUserId returns the session user id when authed", async () => {
  const sessionId = "session-user-uuid";
  const client = buildAuthClient(async () => ({ data: { user: { id: sessionId } } }));
  const id = await resolveTrustedUserId(client);
  assert.equal(id, sessionId);
});

test("resolveTrustedUserId returns null when auth lookup throws", async () => {
  const client = buildAuthClient(async () => {
    throw new Error("auth backend unreachable");
  });
  const id = await resolveTrustedUserId(client);
  assert.equal(id, null);
});

test("resolveTrustedUserId only consults client.auth.getUser (no body input path)", async () => {
  // Behavioral guarantee: the helper signature accepts only the client. There
  // is no parameter through which a forged body value could influence the
  // returned id. This test encodes that invariant for future refactors.
  const calls: string[] = [];
  const client = buildAuthClient(async () => {
    calls.push("getUser");
    return { data: { user: { id: "trusted" } } };
  });
  const id = await resolveTrustedUserId(client);
  assert.equal(id, "trusted");
  assert.deepStrictEqual(calls, ["getUser"]);
});
