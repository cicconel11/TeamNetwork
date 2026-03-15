import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "./utils/supabaseStub.ts";

process.env.LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || "test-client-id";
process.env.LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || "test-client-secret";
process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY =
  process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://example.com";

const USER_ID = "33333333-3333-4333-8333-333333333333";
const EXPIRES_AT = "2099-01-01T00:00:00.000Z";

const {
  syncLinkedInProfile,
  encryptToken,
  getValidLinkedInToken,
  recordLinkedInSyncWarning,
} = await import("@/lib/linkedin/oauth");

function createLinkedInUpdateFailingClient(
  stub: ReturnType<typeof createSupabaseStub>,
  message: string,
) {
  return {
    ...stub,
    from(table: Parameters<typeof stub.from>[0]) {
      const builder = stub.from(table);
      if (table !== "user_linkedin_connections") {
        return builder;
      }

      return {
        ...builder,
        update(updates: Record<string, unknown>) {
          const updateBuilder = builder.update(updates);
          return {
            ...updateBuilder,
            eq(column: string, value: unknown) {
              updateBuilder.eq(column, value);
              return this;
            },
            then(resolve: (value: { data: null; error: { message: string } }) => void) {
              resolve({ data: null, error: { message } });
            },
          };
        },
      };
    },
  };
}

test("syncLinkedInProfile returns an error when profile persistence fails", async (t) => {
  const stub = createSupabaseStub();
  stub.seed("user_linkedin_connections", [{
    user_id: USER_ID,
    access_token_encrypted: encryptToken("access-token"),
    refresh_token_encrypted: encryptToken("refresh-token"),
    token_expires_at: EXPIRES_AT,
    status: "connected",
  }]);

  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(JSON.stringify({
      sub: "sub-123",
      given_name: "Jane",
      family_name: "Doe",
      email: "jane@example.com",
      picture: "https://example.com/jane.jpg",
      email_verified: true,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const result = await syncLinkedInProfile(
    createLinkedInUpdateFailingClient(stub, "write failed") as never,
    USER_ID,
  );

  assert.equal(result.success, false);
  assert.equal(result.error, "Failed to persist LinkedIn profile sync");
});

test("recordLinkedInSyncWarning preserves the connection while storing a sync error", async () => {
  const stub = createSupabaseStub();
  stub.seed("user_linkedin_connections", [{
    user_id: USER_ID,
    status: "connected",
    sync_error: null,
    access_token_encrypted: encryptToken("access-token"),
    refresh_token_encrypted: encryptToken("refresh-token"),
    token_expires_at: EXPIRES_AT,
  }]);

  const persisted = await recordLinkedInSyncWarning(
    stub as never,
    USER_ID,
    "No profile found to update",
  );

  assert.equal(persisted, true);

  const connection = stub.getRows("user_linkedin_connections")[0];
  assert.equal(connection.status, "connected");
  assert.equal(connection.sync_error, "No profile found to update");
});

test("getValidLinkedInToken returns null when refreshed tokens cannot be persisted", async (t) => {
  const stub = createSupabaseStub();
  stub.seed("user_linkedin_connections", [{
    user_id: USER_ID,
    access_token_encrypted: encryptToken("expired-token"),
    refresh_token_encrypted: encryptToken("refresh-token"),
    token_expires_at: "2000-01-01T00:00:00.000Z",
    status: "connected",
  }]);

  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/accessToken")) {
      return new Response(JSON.stringify({
        access_token: "fresh-access-token",
        refresh_token: "fresh-refresh-token",
        expires_in: 3600,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const token = await getValidLinkedInToken(
    createLinkedInUpdateFailingClient(stub, "refresh write failed") as never,
    USER_ID,
  );

  assert.equal(token, null);
});

test("syncLinkedInProfile can recover after a transient userinfo failure", async (t) => {
  const stub = createSupabaseStub();
  stub.seed("user_linkedin_connections", [{
    user_id: USER_ID,
    access_token_encrypted: encryptToken("access-token"),
    refresh_token_encrypted: encryptToken("refresh-token"),
    token_expires_at: EXPIRES_AT,
    status: "connected",
    sync_error: null,
  }]);
  stub.seed("members", [{
    user_id: USER_ID,
    first_name: "Old",
    last_name: "Member",
    photo_url: null,
    deleted_at: null,
  }]);
  stub.registerRpc("sync_user_linkedin_profile_fields", async ({
    p_user_id,
    p_first_name,
    p_last_name,
    p_photo_url,
  }) => {
    const { data } = await stub
      .from("members")
      .update({
        first_name: p_first_name,
        last_name: p_last_name,
        photo_url: p_photo_url,
      })
      .eq("user_id", p_user_id)
      .is("deleted_at", null);

    return { updated_count: data?.length ?? 0 };
  });

  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    fetchCount += 1;
    if (fetchCount === 1) {
      return new Response("temporary outage", { status: 503 });
    }

    return new Response(JSON.stringify({
      sub: "sub-123",
      given_name: "Jane",
      family_name: "Doe",
      email: "jane@example.com",
      picture: "https://example.com/jane.jpg",
      email_verified: true,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const firstResult = await syncLinkedInProfile(stub as never, USER_ID);
  const secondResult = await syncLinkedInProfile(stub as never, USER_ID);

  assert.equal(firstResult.success, false);
  assert.equal(firstResult.error, "Failed to fetch profile from LinkedIn");
  assert.equal(secondResult.success, true);

  const connection = stub.getRows("user_linkedin_connections")[0];
  assert.equal(connection.status, "connected");
  assert.equal(connection.sync_error, null);
});

test("syncLinkedInProfile propagates synced fields into active org profile rows", async (t) => {
  const stub = createSupabaseStub();
  stub.seed("user_linkedin_connections", [{
    user_id: USER_ID,
    access_token_encrypted: encryptToken("access-token"),
    refresh_token_encrypted: encryptToken("refresh-token"),
    token_expires_at: EXPIRES_AT,
    status: "connected",
    sync_error: null,
  }]);
  stub.seed("members", [{
    user_id: USER_ID,
    first_name: "Old",
    last_name: "Member",
    photo_url: "https://example.com/old-member.jpg",
    deleted_at: null,
  }, {
    user_id: USER_ID,
    first_name: "Deleted",
    last_name: "Member",
    photo_url: "https://example.com/deleted-member.jpg",
    deleted_at: "2026-03-01T00:00:00.000Z",
  }]);
  stub.seed("alumni", [{
    user_id: USER_ID,
    first_name: "Old",
    last_name: "Alumni",
    photo_url: null,
    deleted_at: null,
  }]);
  stub.seed("parents", [{
    user_id: USER_ID,
    first_name: "Old",
    last_name: "Parent",
    photo_url: "https://example.com/old-parent.jpg",
    deleted_at: null,
  }]);

  stub.registerRpc("sync_user_linkedin_profile_fields", async ({
    p_user_id,
    p_first_name,
    p_last_name,
    p_photo_url,
  }) => {
    assert.equal(p_user_id, USER_ID);
    assert.equal(p_first_name, "Jane");
    assert.equal(p_last_name, "Doe");
    assert.equal(p_photo_url, "https://example.com/jane.jpg");

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
  });

  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(JSON.stringify({
      sub: "sub-123",
      given_name: "Jane",
      family_name: "Doe",
      email: "jane@example.com",
      picture: "https://example.com/jane.jpg",
      email_verified: true,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const result = await syncLinkedInProfile(stub as never, USER_ID);

  assert.equal(result.success, true);
  assert.equal(stub.getRows("members")[0]?.first_name, "Jane");
  assert.equal(stub.getRows("members")[0]?.last_name, "Doe");
  assert.equal(stub.getRows("members")[0]?.photo_url, "https://example.com/jane.jpg");
  assert.equal(stub.getRows("members")[1]?.first_name, "Deleted");
  assert.equal(stub.getRows("alumni")[0]?.first_name, "Jane");
  assert.equal(stub.getRows("alumni")[0]?.last_name, "Doe");
  assert.equal(stub.getRows("alumni")[0]?.photo_url, "https://example.com/jane.jpg");
  assert.equal(stub.getRows("parents")[0]?.first_name, "Jane");
  assert.equal(stub.getRows("parents")[0]?.last_name, "Doe");
  assert.equal(stub.getRows("parents")[0]?.photo_url, "https://example.com/jane.jpg");
});

test("syncLinkedInProfile returns an error when org profile propagation fails", async (t) => {
  const stub = createSupabaseStub();
  stub.seed("user_linkedin_connections", [{
    user_id: USER_ID,
    access_token_encrypted: encryptToken("access-token"),
    refresh_token_encrypted: encryptToken("refresh-token"),
    token_expires_at: EXPIRES_AT,
    status: "connected",
  }]);
  stub.seed("members", [{
    user_id: USER_ID,
    first_name: "Old",
    last_name: "Member",
    photo_url: null,
    deleted_at: null,
  }]);
  stub.registerRpc("sync_user_linkedin_profile_fields", () => {
    throw new Error("profile sync failed");
  });

  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(JSON.stringify({
      sub: "sub-123",
      given_name: "Jane",
      family_name: "Doe",
      email: "jane@example.com",
      picture: "https://example.com/jane.jpg",
      email_verified: true,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const result = await syncLinkedInProfile(stub as never, USER_ID);

  assert.equal(result.success, false);
  assert.equal(result.error, "Failed to sync LinkedIn profile to your organization profile");
});

test("syncLinkedInProfile returns an error when no active org profile rows exist", async (t) => {
  const stub = createSupabaseStub();
  stub.seed("user_linkedin_connections", [{
    user_id: USER_ID,
    access_token_encrypted: encryptToken("access-token"),
    refresh_token_encrypted: encryptToken("refresh-token"),
    token_expires_at: EXPIRES_AT,
    status: "connected",
  }]);
  stub.registerRpc("sync_user_linkedin_profile_fields", () => ({ updated_count: 0 }));

  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(JSON.stringify({
      sub: "sub-123",
      given_name: "Jane",
      family_name: "Doe",
      email: "jane@example.com",
      picture: "https://example.com/jane.jpg",
      email_verified: true,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const result = await syncLinkedInProfile(stub as never, USER_ID);

  assert.equal(result.success, false);
  assert.equal(result.error, "No profile found to update");
});
