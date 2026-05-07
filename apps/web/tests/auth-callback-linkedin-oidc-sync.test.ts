import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createSupabaseStub } from "./utils/supabaseStub.ts";

// ---------------------------------------------------------------------------
// Env setup
// ---------------------------------------------------------------------------

process.env.LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || "test-client-id";
process.env.LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || "test-client-secret";
process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY =
  process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://example.com";

const { syncLinkedInOidcProfileOnLogin } = await import("@/lib/linkedin/oidc-sync");

const USER_ID = "55555555-5555-4555-8555-555555555555";

// ---------------------------------------------------------------------------
// Part 1: Source-level wiring tests for src/app/auth/callback/route.ts
//
// These guard against accidental removal or reordering of the LinkedIn OIDC
// sync branch in the auth callback. A source test is appropriate here because
// the route handler depends on Next.js request/response infrastructure that
// is prohibitively expensive to stub in a unit test.
// ---------------------------------------------------------------------------

const callbackRoutePath = path.resolve(
  import.meta.dirname,
  "..",
  "src",
  "app",
  "auth",
  "callback",
  "route.ts",
);
const callbackRouteSource = fs.readFileSync(callbackRoutePath, "utf8");

test("auth callback imports runLinkedInOidcSyncSafe and LINKEDIN_OIDC_PROVIDER", () => {
  assert.match(
    callbackRouteSource,
    /import\s+\{[^}]*runLinkedInOidcSyncSafe[^}]*\}\s+from\s+["']@\/lib\/linkedin\/oidc-sync["']/,
    "auth callback must import runLinkedInOidcSyncSafe from oidc-sync module",
  );
  assert.match(
    callbackRouteSource,
    /import\s+\{[^}]*LINKEDIN_OIDC_PROVIDER[^}]*\}\s+from\s+["']@\/lib\/linkedin\/config["']/,
    "auth callback must import LINKEDIN_OIDC_PROVIDER from browser-safe config module",
  );
});

test("auth callback checks for LINKEDIN_OIDC_PROVIDER before syncing", () => {
  assert.match(
    callbackRouteSource,
    /provider\s*===\s*LINKEDIN_OIDC_PROVIDER/,
    "auth callback must gate sync on LINKEDIN_OIDC_PROVIDER constant (not a raw string)",
  );
});

test("auth callback schedules sync without awaiting the redirect path", () => {
  assert.match(
    callbackRouteSource,
    /queueMicrotask\(\(\)\s*=>\s*\{\s*void runLinkedInOidcSyncSafe\(createServiceClient,\s*data\.session\.user\);?\s*\}\)/,
    "auth callback must use queueMicrotask to fire-and-forget the LinkedIn sync",
  );
  assert.doesNotMatch(
    callbackRouteSource,
    /await\s+runLinkedInOidcSyncSafe\(/,
    "auth callback must not await runLinkedInOidcSyncSafe on the redirect path",
  );
});

test("auth callback places LinkedIn sync after age gate, before redirect", () => {
  const ageGateIndex = callbackRouteSource.indexOf("ageGateResult.kind");
  const importIndex = callbackRouteSource.indexOf("runLinkedInOidcSyncSafe");
  const syncCallIndex = callbackRouteSource.indexOf("runLinkedInOidcSyncSafe", importIndex + 1);
  const returnResponseIndex = callbackRouteSource.indexOf("return response;");

  assert.ok(ageGateIndex > -1, "should contain age gate check");
  assert.ok(syncCallIndex > -1, "should contain runLinkedInOidcSyncSafe call (beyond import)");
  assert.ok(returnResponseIndex > -1, "should contain return response");
  assert.ok(
    ageGateIndex < syncCallIndex,
    "LinkedIn sync call must come AFTER age gate check",
  );
  assert.ok(
    syncCallIndex < returnResponseIndex,
    "LinkedIn sync call must come BEFORE return response",
  );
});

test("auth callback passes createServiceClient factory and session user", () => {
  assert.match(
    callbackRouteSource,
    /runLinkedInOidcSyncSafe\(createServiceClient,\s*data\.session\.user\)/,
    "sync function must receive the service client factory and session user object",
  );
});

// ---------------------------------------------------------------------------
// Part 2: Integration tests — exercise the full sync chain with a realistic
// Supabase Auth user shape, verifying that the helper correctly extracts
// profile data from a user that looks like what `exchangeCodeForSession`
// returns for a LinkedIn OIDC login.
// ---------------------------------------------------------------------------

function makeRealisticLinkedInOidcUser(overrides: Record<string, unknown> = {}) {
  // Mimics what Supabase Auth returns from exchangeCodeForSession for LinkedIn OIDC
  return {
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "jane.doe@example.com",
    email_confirmed_at: "2026-03-13T12:00:00.000000Z",
    phone: "",
    confirmed_at: "2026-03-13T12:00:00.000000Z",
    created_at: "2026-03-13T12:00:00.000000Z",
    updated_at: "2026-03-13T12:00:00.000000Z",
    app_metadata: {
      provider: "linkedin_oidc",
      providers: ["linkedin_oidc"],
    },
    user_metadata: {
      email: "jane.doe@example.com",
      email_verified: true,
      full_name: "Jane Doe",
      given_name: "Jane",
      family_name: "Doe",
      iss: "https://www.linkedin.com/oauth",
      name: "Jane Doe",
      picture: "https://media.licdn.com/dms/image/example/photo.jpg",
      sub: "abc123def456",
    },
    identities: [
      {
        identity_id: "identity-uuid",
        id: "abc123def456",
        user_id: USER_ID,
        identity_data: {
          email: "jane.doe@example.com",
          email_verified: true,
          full_name: "Jane Doe",
          given_name: "Jane",
          family_name: "Doe",
          iss: "https://www.linkedin.com/oauth",
          name: "Jane Doe",
          picture: "https://media.licdn.com/dms/image/example/photo.jpg",
          sub: "abc123def456",
        },
        provider: "linkedin_oidc",
        last_sign_in_at: "2026-03-13T12:00:00.000000Z",
        created_at: "2026-03-13T12:00:00.000000Z",
        updated_at: "2026-03-13T12:00:00.000000Z",
      },
    ],
    ...overrides,
  } as never;
}

test("integration: syncs LinkedIn profile into member records for a realistic OIDC user", async () => {
  const stub = createSupabaseStub();
  stub.seed("members", [
    {
      user_id: USER_ID,
      first_name: "Jane",
      last_name: "Smith",
      photo_url: null,
      deleted_at: null,
    },
  ]);

  stub.registerRpc(
    "sync_user_linkedin_profile_fields",
    async ({
      p_user_id,
      p_first_name,
      p_last_name,
      p_photo_url,
    }: {
      p_user_id: string;
      p_first_name: string | null;
      p_last_name: string | null;
      p_photo_url: string | null;
    }) => {
      let updatedCount = 0;
      for (const table of ["members", "alumni", "parents"] as const) {
        const { data } = await stub
          .from(table)
          .update({
            first_name: p_first_name,
            last_name: p_last_name,
            photo_url: p_photo_url,
          })
          .eq("user_id", p_user_id)
          .is("deleted_at", null);
        updatedCount += data?.length ?? 0;
      }
      return { updated_count: updatedCount };
    },
  );

  const result = await syncLinkedInOidcProfileOnLogin(
    stub as never,
    makeRealisticLinkedInOidcUser(),
  );

  assert.ok("synced" in result);
  assert.equal((result as { synced: boolean }).synced, true);

  // Verify profile data was extracted and propagated correctly
  const member = stub.getRows("members")[0];
  assert.equal(member.first_name, "Jane");
  assert.equal(member.last_name, "Doe");
  assert.equal(member.photo_url, "https://media.licdn.com/dms/image/example/photo.jpg");

  // Verify connection record was created with OIDC sentinel
  const connections = stub.getRows("user_linkedin_connections");
  assert.equal(connections.length, 1);
  assert.equal(connections[0].linkedin_sub, "abc123def456");
  assert.equal(connections[0].access_token_encrypted, "__oidc_login__");
  assert.deepEqual(connections[0].linkedin_data, { source: "oidc_login" });
});

test("integration: Google OIDC user does not trigger LinkedIn sync", async () => {
  const stub = createSupabaseStub();
  stub.seed("members", [
    {
      user_id: USER_ID,
      first_name: "Jane",
      last_name: "Smith",
      photo_url: null,
      deleted_at: null,
    },
  ]);

  const result = await syncLinkedInOidcProfileOnLogin(
    stub as never,
    makeRealisticLinkedInOidcUser({
      app_metadata: {
        provider: "google",
        providers: ["google"],
      },
    }),
  );

  assert.ok("skipped" in result);

  // Member data should be untouched
  const member = stub.getRows("members")[0];
  assert.equal(member.first_name, "Jane");
  assert.equal(member.last_name, "Smith");

  // No connection record created
  assert.equal(stub.getRows("user_linkedin_connections").length, 0);
});

test("integration: LinkedIn sync failure does not throw (login resilience)", async () => {
  const stub = createSupabaseStub();

  // RPC throws — simulate a database outage
  stub.registerRpc("sync_user_linkedin_profile_fields", () => {
    throw new Error("database connection refused");
  });

  // The function must NOT throw, even when everything fails
  const result = await syncLinkedInOidcProfileOnLogin(
    stub as never,
    makeRealisticLinkedInOidcUser(),
  );

  // Should return a structured error, not throw
  assert.ok("synced" in result);
  assert.equal((result as { synced: boolean }).synced, false);
  assert.ok("error" in result);
});

test("integration: user with only full_name (no given/family) gets name split correctly", async () => {
  const stub = createSupabaseStub();
  stub.seed("members", [
    {
      user_id: USER_ID,
      first_name: "Old",
      last_name: "Name",
      photo_url: null,
      deleted_at: null,
    },
  ]);

  stub.registerRpc(
    "sync_user_linkedin_profile_fields",
    async ({
      p_user_id,
      p_first_name,
      p_last_name,
      p_photo_url,
    }: {
      p_user_id: string;
      p_first_name: string | null;
      p_last_name: string | null;
      p_photo_url: string | null;
    }) => {
      let updatedCount = 0;
      for (const table of ["members", "alumni", "parents"] as const) {
        const { data } = await stub
          .from(table)
          .update({
            first_name: p_first_name,
            last_name: p_last_name,
            photo_url: p_photo_url,
          })
          .eq("user_id", p_user_id)
          .is("deleted_at", null);
        updatedCount += data?.length ?? 0;
      }
      return { updated_count: updatedCount };
    },
  );

  // Simulate a user whose identity_data only has `name` (no given/family)
  const result = await syncLinkedInOidcProfileOnLogin(
    stub as never,
    makeRealisticLinkedInOidcUser({
      identities: [
        {
          provider: "linkedin_oidc",
          identity_data: {
            name: "Alice Wonderland",
            email: "alice@example.com",
            sub: "alice-sub",
          },
        },
      ],
      user_metadata: {
        name: "Alice Wonderland",
        email: "alice@example.com",
        sub: "alice-sub",
      },
    }),
  );

  assert.ok("synced" in result);
  assert.equal((result as { synced: boolean }).synced, true);

  const member = stub.getRows("members")[0];
  assert.equal(member.first_name, "Alice");
  assert.equal(member.last_name, "Wonderland");
});
