import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "./utils/supabaseStub.ts";

process.env.LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || "test-client-id";
process.env.LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || "test-client-secret";
process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY =
  process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://example.com";

const USER_ID = "44444444-4444-4444-8444-444444444444";

const {
  syncLinkedInOidcProfileOnLogin,
  extractLinkedInProfile,
  storeLinkedInOidcConnection,
  runLinkedInOidcSyncSafe,
} = await import("@/lib/linkedin/oidc-sync");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: "jane@example.com",
    created_at: "2026-01-01T00:00:00.000Z",
    app_metadata: { provider: "linkedin_oidc" },
    user_metadata: {
      given_name: "Jane",
      family_name: "Doe",
      email: "jane@example.com",
      picture: "https://example.com/jane.jpg",
      sub: "linkedin-sub-123",
      email_verified: true,
    },
    identities: [
      {
        provider: "linkedin_oidc",
        identity_data: {
          given_name: "Jane",
          family_name: "Doe",
          email: "jane@example.com",
          picture: "https://example.com/jane.jpg",
          sub: "linkedin-sub-123",
          email_verified: true,
        },
      },
    ],
    ...overrides,
  } as never;
}

function registerSyncRpc(stub: ReturnType<typeof createSupabaseStub>) {
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
}

// ---------------------------------------------------------------------------
// extractLinkedInProfile
// ---------------------------------------------------------------------------

test("extractLinkedInProfile extracts from identity_data", () => {
  const profile = extractLinkedInProfile(makeUser());

  assert.equal(profile.givenName, "Jane");
  assert.equal(profile.familyName, "Doe");
  assert.equal(profile.email, "jane@example.com");
  assert.equal(profile.picture, "https://example.com/jane.jpg");
  assert.equal(profile.sub, "linkedin-sub-123");
});

test("extractLinkedInProfile falls back to user_metadata when no identity matches", () => {
  const profile = extractLinkedInProfile(
    makeUser({ identities: [] }),
  );

  assert.equal(profile.givenName, "Jane");
  assert.equal(profile.familyName, "Doe");
});

test("extractLinkedInProfile merges partial identity_data with user_metadata", () => {
  const profile = extractLinkedInProfile(
    makeUser({
      user_metadata: {
        given_name: "Jane",
        family_name: "Doe",
        email: "jane@example.com",
        picture: "https://example.com/from-user-metadata.jpg",
        sub: "linkedin-sub-from-user-metadata",
        email_verified: true,
      },
      identities: [
        {
          provider: "linkedin_oidc",
          identity_data: {
            email: "jane-from-identity@example.com",
            picture: "https://example.com/from-identity.jpg",
          },
        },
      ],
    }),
  );

  assert.equal(profile.givenName, "Jane");
  assert.equal(profile.familyName, "Doe");
  assert.equal(profile.email, "jane-from-identity@example.com");
  assert.equal(profile.picture, "https://example.com/from-identity.jpg");
  assert.equal(profile.sub, "linkedin-sub-from-user-metadata");
  assert.equal(profile.emailVerified, true);
});

test("extractLinkedInProfile splits full_name when given_name is absent", () => {
  const profile = extractLinkedInProfile(
    makeUser({
      identities: [],
      user_metadata: {
        full_name: "Alice Wonderland",
        email: "alice@example.com",
        sub: "sub-alice",
      },
    }),
  );

  assert.equal(profile.givenName, "Alice");
  assert.equal(profile.familyName, "Wonderland");
});

test("extractLinkedInProfile handles multi-word last names from name split", () => {
  const profile = extractLinkedInProfile(
    makeUser({
      identities: [],
      user_metadata: {
        name: "Mary Jane Watson",
        email: "mj@example.com",
        sub: "sub-mj",
      },
    }),
  );

  assert.equal(profile.givenName, "Mary");
  assert.equal(profile.familyName, "Jane Watson");
});

// ---------------------------------------------------------------------------
// syncLinkedInOidcProfileOnLogin — skip non-LinkedIn
// ---------------------------------------------------------------------------

test("returns skipped when provider is not linkedin_oidc", async () => {
  const stub = createSupabaseStub();
  const result = await syncLinkedInOidcProfileOnLogin(
    stub as never,
    makeUser({ app_metadata: { provider: "google" } }),
  );

  assert.ok("skipped" in result);
  assert.equal((result as { skipped: boolean }).skipped, true);
});

// ---------------------------------------------------------------------------
// syncLinkedInOidcProfileOnLogin — profile sync
// ---------------------------------------------------------------------------

test("syncs profile fields to members/alumni/parents on OIDC login", async () => {
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
  stub.seed("alumni", [
    {
      user_id: USER_ID,
      first_name: "Old",
      last_name: "Alumni",
      photo_url: null,
      deleted_at: null,
    },
  ]);
  registerSyncRpc(stub);

  const result = await syncLinkedInOidcProfileOnLogin(
    stub as never,
    makeUser(),
  );

  assert.ok("synced" in result);
  assert.equal((result as { synced: boolean }).synced, true);

  assert.equal(stub.getRows("members")[0]?.first_name, "Jane");
  assert.equal(stub.getRows("members")[0]?.last_name, "Doe");
  assert.equal(stub.getRows("members")[0]?.photo_url, "https://example.com/jane.jpg");
  assert.equal(stub.getRows("alumni")[0]?.first_name, "Jane");
});

// ---------------------------------------------------------------------------
// storeLinkedInOidcConnection — new OIDC user
// ---------------------------------------------------------------------------

test("creates connection record for new OIDC user", async () => {
  const stub = createSupabaseStub();
  const profile = extractLinkedInProfile(makeUser());

  const result = await storeLinkedInOidcConnection(
    stub as never,
    USER_ID,
    profile,
  );

  assert.equal(result.success, true);

  const rows = stub.getRows("user_linkedin_connections");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, USER_ID);
  assert.equal(rows[0].linkedin_sub, "linkedin-sub-123");
  assert.equal(rows[0].linkedin_given_name, "Jane");
  assert.equal(rows[0].linkedin_family_name, "Doe");
  assert.equal(rows[0].access_token_encrypted, "__oidc_login__");
  assert.equal(rows[0].status, "connected");
  assert.deepEqual(rows[0].linkedin_data, { source: "oidc_login" });
});

// ---------------------------------------------------------------------------
// storeLinkedInOidcConnection — does NOT overwrite real OAuth connection
// ---------------------------------------------------------------------------

test("does not overwrite existing connection with real tokens", async () => {
  const stub = createSupabaseStub();
  stub.seed("user_linkedin_connections", [
    {
      user_id: USER_ID,
      linkedin_sub: "existing-sub",
      linkedin_given_name: "Existing",
      linkedin_family_name: "User",
      access_token_encrypted: "real-encrypted-token",
      refresh_token_encrypted: "real-refresh-token",
      token_expires_at: "2099-01-01T00:00:00.000Z",
      status: "connected",
      linkedin_data: { email_verified: true },
    },
  ]);

  const profile = extractLinkedInProfile(makeUser());
  const result = await storeLinkedInOidcConnection(
    stub as never,
    USER_ID,
    profile,
  );

  assert.equal(result.success, true);

  const rows = stub.getRows("user_linkedin_connections");
  assert.equal(rows.length, 1);
  // Real tokens should be preserved — the OIDC update targets source=oidc_login only
  assert.equal(rows[0].access_token_encrypted, "real-encrypted-token");
  assert.equal(rows[0].linkedin_given_name, "Existing");
});

// ---------------------------------------------------------------------------
// storeLinkedInOidcConnection — DOES update existing OIDC connection
// ---------------------------------------------------------------------------

test("updates existing OIDC connection with fresh data", async () => {
  const stub = createSupabaseStub();
  stub.seed("user_linkedin_connections", [
    {
      user_id: USER_ID,
      linkedin_sub: "old-sub",
      linkedin_given_name: "OldFirst",
      linkedin_family_name: "OldLast",
      access_token_encrypted: "__oidc_login__",
      token_expires_at: "1970-01-01T00:00:00.000Z",
      status: "connected",
      linkedin_data: { source: "oidc_login" },
    },
  ]);

  const profile = extractLinkedInProfile(makeUser());
  const result = await storeLinkedInOidcConnection(
    stub as never,
    USER_ID,
    profile,
  );

  assert.equal(result.success, true);

  const rows = stub.getRows("user_linkedin_connections");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].linkedin_given_name, "Jane");
  assert.equal(rows[0].linkedin_family_name, "Doe");
  assert.equal(rows[0].linkedin_sub, "linkedin-sub-123");
});

test("skips OIDC connection storage when LinkedIn subject is unavailable", async () => {
  const stub = createSupabaseStub();

  const result = await storeLinkedInOidcConnection(
    stub as never,
    USER_ID,
    {
      sub: "",
      givenName: "Jane",
      familyName: "Doe",
      email: "jane@example.com",
      picture: null,
      emailVerified: true,
    },
  );

  assert.equal(result.success, true);
  assert.equal(stub.getRows("user_linkedin_connections").length, 0);
});

// ---------------------------------------------------------------------------
// syncLinkedInOidcProfileOnLogin — treats updated_count=0 as success
// ---------------------------------------------------------------------------

test("treats updated_count=0 as success (user has no org memberships yet)", async () => {
  const stub = createSupabaseStub();
  stub.registerRpc("sync_user_linkedin_profile_fields", () => ({
    updated_count: 0,
  }));

  const result = await syncLinkedInOidcProfileOnLogin(
    stub as never,
    makeUser(),
  );

  assert.ok("synced" in result);
  assert.equal((result as { synced: boolean }).synced, true);
});

// ---------------------------------------------------------------------------
// syncLinkedInOidcProfileOnLogin — returns error (not throws) when RPC fails
// ---------------------------------------------------------------------------

test("returns error result when RPC fails (never throws)", async () => {
  const stub = createSupabaseStub();
  stub.registerRpc("sync_user_linkedin_profile_fields", () => {
    throw new Error("rpc exploded");
  });

  const result = await syncLinkedInOidcProfileOnLogin(
    stub as never,
    makeUser(),
  );

  assert.ok("synced" in result);
  assert.equal((result as { synced: boolean }).synced, false);
  assert.ok("error" in result);
});

// ---------------------------------------------------------------------------
// syncLinkedInOidcProfileOnLogin — connection failure prevents profile sync
// ---------------------------------------------------------------------------

test("connection write failure returns synced:false and skips profile sync", async () => {
  const stub = createSupabaseStub();

  // Seed a member row so we can detect if profile sync ran
  stub.seed("members", [
    {
      user_id: USER_ID,
      first_name: "Original",
      last_name: "Name",
      photo_url: null,
      deleted_at: null,
    },
  ]);
  registerSyncRpc(stub);

  // Force the connection table to return errors
  stub.simulateError("user_linkedin_connections", {
    message: "connection refused",
    code: "PGRST000",
  });

  const result = await syncLinkedInOidcProfileOnLogin(
    stub as never,
    makeUser(),
  );

  assert.ok("synced" in result);
  assert.equal((result as { synced: boolean }).synced, false);
  assert.ok("error" in result);

  // Profile sync should NOT have run — member data untouched
  const member = stub.getRows("members")[0];
  assert.equal(member.first_name, "Original", "profile sync must not run when connection write fails");
});

// ---------------------------------------------------------------------------
// runLinkedInOidcSyncSafe
// ---------------------------------------------------------------------------

test("runLinkedInOidcSyncSafe catches errors from runSync without throwing", async () => {
  const stub = createSupabaseStub();

  await runLinkedInOidcSyncSafe(
    () => stub as never,
    makeUser(),
    async () => {
      throw new Error("db crashed");
    },
  );

  // Should complete without throwing — the error is caught internally
});

test("runLinkedInOidcSyncSafe logs non-success results", async () => {
  const stub = createSupabaseStub();
  const logged: unknown[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };

  try {
    await runLinkedInOidcSyncSafe(
      () => stub as never,
      makeUser(),
      async () => ({ synced: false, error: "test failure" }),
    );

    const syncLog = logged.find(
      (args) => Array.isArray(args) && typeof args[0] === "string" && args[0].includes("returned error"),
    );
    assert.ok(syncLog, "runLinkedInOidcSyncSafe must log non-success sync results");
  } finally {
    console.error = originalError;
  }
});

// ---------------------------------------------------------------------------
// syncLinkedInOidcProfileOnLogin — propagates linkedin_url from org records
// ---------------------------------------------------------------------------

test("propagates linkedin_url from existing org record to all profiles", async () => {
  const stub = createSupabaseStub();
  stub.seed("members", [
    {
      user_id: USER_ID,
      first_name: "Jane",
      last_name: "Doe",
      photo_url: null,
      linkedin_url: "https://www.linkedin.com/in/janedoe",
      deleted_at: null,
    },
  ]);
  stub.seed("alumni", [
    {
      user_id: USER_ID,
      first_name: "Jane",
      last_name: "Doe",
      photo_url: null,
      linkedin_url: null,
      deleted_at: null,
    },
  ]);
  registerSyncRpc(stub);

  let savedUrl: string | null = null;
  stub.registerRpc(
    "save_user_linkedin_url",
    ({ p_user_id, p_linkedin_url }: { p_user_id: string; p_linkedin_url: string | null }) => {
      savedUrl = p_linkedin_url;
      // Simulate updating all org records
      for (const table of ["members", "alumni"] as const) {
        const rows = stub.getRows(table);
        for (const r of rows) {
          if (r.user_id === p_user_id && !r.deleted_at) {
            r.linkedin_url = p_linkedin_url;
          }
        }
      }
      return { updated_count: 2 };
    },
  );

  const result = await syncLinkedInOidcProfileOnLogin(
    stub as never,
    makeUser(),
  );

  assert.ok("synced" in result);
  assert.equal((result as { synced: boolean }).synced, true);
  assert.equal(savedUrl, "https://www.linkedin.com/in/janedoe");
});

test("does not call save_user_linkedin_url when no org record has linkedin_url", async () => {
  const stub = createSupabaseStub();
  stub.seed("members", [
    {
      user_id: USER_ID,
      first_name: "Jane",
      last_name: "Doe",
      photo_url: null,
      linkedin_url: null,
      deleted_at: null,
    },
  ]);
  registerSyncRpc(stub);

  let rpcCalled = false;
  stub.registerRpc(
    "save_user_linkedin_url",
    () => {
      rpcCalled = true;
      return { updated_count: 1 };
    },
  );

  const result = await syncLinkedInOidcProfileOnLogin(
    stub as never,
    makeUser(),
  );

  assert.ok("synced" in result);
  assert.equal((result as { synced: boolean }).synced, true);
  assert.equal(rpcCalled, false, "save_user_linkedin_url should not be called when no org record has linkedin_url");
});

test("linkedin_url propagation failure does not fail the sync", async () => {
  const stub = createSupabaseStub();
  stub.seed("members", [
    {
      user_id: USER_ID,
      first_name: "Jane",
      last_name: "Doe",
      photo_url: null,
      linkedin_url: "https://www.linkedin.com/in/janedoe",
      deleted_at: null,
    },
  ]);
  registerSyncRpc(stub);

  stub.registerRpc("save_user_linkedin_url", () => {
    throw new Error("db error");
  });

  const result = await syncLinkedInOidcProfileOnLogin(
    stub as never,
    makeUser(),
  );

  // Should still succeed — URL propagation is best-effort
  assert.ok("synced" in result);
  assert.equal((result as { synced: boolean }).synced, true);
});

// ---------------------------------------------------------------------------
// runLinkedInOidcSyncSafe
// ---------------------------------------------------------------------------

test("propagates the most recently updated linkedin_url when records disagree", async () => {
  const stub = createSupabaseStub();
  stub.seed("members", [
    {
      user_id: USER_ID,
      first_name: "Jane",
      last_name: "Doe",
      photo_url: null,
      linkedin_url: "https://www.linkedin.com/in/old-url",
      updated_at: "2026-01-01T00:00:00.000Z",
      deleted_at: null,
    },
  ]);
  stub.seed("alumni", [
    {
      user_id: USER_ID,
      first_name: "Jane",
      last_name: "Doe",
      photo_url: null,
      linkedin_url: "https://www.linkedin.com/in/newer-url",
      updated_at: "2026-06-01T00:00:00.000Z",
      deleted_at: null,
    },
  ]);

  // Use the real sync RPC simulation — the ordering fix ensures
  // findExistingLinkedInUrl runs BEFORE sync touches updated_at.
  registerSyncRpc(stub);

  let savedUrl: string | null = null;
  stub.registerRpc("save_user_linkedin_url", ({ p_linkedin_url }: { p_linkedin_url: string | null }) => {
    savedUrl = p_linkedin_url;
    return { updated_count: 2 };
  });

  await syncLinkedInOidcProfileOnLogin(stub as never, makeUser());
  assert.equal(savedUrl, "https://www.linkedin.com/in/newer-url");
});

test("aborts linkedin_url propagation when a table read fails", async () => {
  const stub = createSupabaseStub();
  stub.seed("members", [
    {
      user_id: USER_ID,
      first_name: "Jane",
      last_name: "Doe",
      photo_url: null,
      linkedin_url: "https://www.linkedin.com/in/janedoe",
      updated_at: "2026-01-01T00:00:00.000Z",
      deleted_at: null,
    },
  ]);
  stub.seed("alumni", [
    {
      user_id: USER_ID,
      first_name: "Jane",
      last_name: "Doe",
      photo_url: null,
      linkedin_url: null,
      deleted_at: null,
    },
  ]);
  registerSyncRpc(stub);

  // Simulate an error on the alumni table — findExistingLinkedInUrl should
  // bail out and return null, so save_user_linkedin_url is never called.
  stub.simulateError("alumni", {
    message: "permission denied",
    code: "42501",
  });

  let rpcCalled = false;
  stub.registerRpc("save_user_linkedin_url", () => {
    rpcCalled = true;
    return { updated_count: 1 };
  });

  const result = await syncLinkedInOidcProfileOnLogin(stub as never, makeUser());

  assert.ok("synced" in result);
  assert.equal((result as { synced: boolean }).synced, true);
  assert.equal(rpcCalled, false, "save_user_linkedin_url must not be called when a table read fails");
});

test("skips linkedin_url propagation when records disagree with equal updated_at", async () => {
  const stub = createSupabaseStub();
  stub.seed("members", [
    {
      user_id: USER_ID,
      first_name: "Jane",
      last_name: "Doe",
      photo_url: null,
      linkedin_url: "https://www.linkedin.com/in/member-url",
      updated_at: "2026-06-01T00:00:00.000Z",
      deleted_at: null,
    },
  ]);
  stub.seed("alumni", [
    {
      user_id: USER_ID,
      first_name: "Jane",
      last_name: "Doe",
      photo_url: null,
      linkedin_url: "https://www.linkedin.com/in/alumni-url",
      updated_at: "2026-06-01T00:00:00.000Z",
      deleted_at: null,
    },
  ]);
  registerSyncRpc(stub);

  let rpcCalled = false;
  stub.registerRpc("save_user_linkedin_url", () => {
    rpcCalled = true;
    return { updated_count: 2 };
  });

  const result = await syncLinkedInOidcProfileOnLogin(stub as never, makeUser());

  assert.ok("synced" in result);
  assert.equal((result as { synced: boolean }).synced, true);
  assert.equal(rpcCalled, false, "save_user_linkedin_url must not be called when timestamps tie but URLs differ");
});

test("skips propagation when same-table records disagree with equal updated_at", async () => {
  const stub = createSupabaseStub();
  // Two members rows (same user, different orgs) with same updated_at but different URLs
  stub.seed("members", [
    {
      user_id: USER_ID,
      first_name: "Jane",
      last_name: "Doe",
      photo_url: null,
      linkedin_url: "https://www.linkedin.com/in/url-from-org-a",
      updated_at: "2026-06-01T00:00:00.000Z",
      deleted_at: null,
    },
    {
      user_id: USER_ID,
      first_name: "Jane",
      last_name: "Doe",
      photo_url: null,
      linkedin_url: "https://www.linkedin.com/in/url-from-org-b",
      updated_at: "2026-06-01T00:00:00.000Z",
      deleted_at: null,
    },
  ]);
  registerSyncRpc(stub);

  let rpcCalled = false;
  stub.registerRpc("save_user_linkedin_url", () => {
    rpcCalled = true;
    return { updated_count: 2 };
  });

  const result = await syncLinkedInOidcProfileOnLogin(stub as never, makeUser());

  assert.ok("synced" in result);
  assert.equal((result as { synced: boolean }).synced, true);
  assert.equal(rpcCalled, false, "save_user_linkedin_url must not be called when same-table records disagree");
});

test("runLinkedInOidcSyncSafe awaits the sync runner to completion", async () => {
  const stub = createSupabaseStub();
  let completed = false;

  await runLinkedInOidcSyncSafe(
    () => stub as never,
    makeUser(),
    async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      completed = true;
      return { synced: true };
    },
  );

  assert.equal(completed, true, "sync must complete before runLinkedInOidcSyncSafe resolves");
});
