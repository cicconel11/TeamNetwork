/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * Tests for the shared token refresh helper.
 *
 * Strategy: use a real 64-hex encryption key so encryptToken/decryptToken work,
 * and mock globalThis.fetch to control refreshAccessToken responses.
 * This avoids module-level mocking complexity.
 */

// 64 hex chars = 32 bytes for AES-256-GCM
const TEST_KEY = "a".repeat(64);

// Set env vars before any module import
process.env.BLACKBAUD_TOKEN_ENCRYPTION_KEY = TEST_KEY;
process.env.BLACKBAUD_CLIENT_ID = "test-client-id";
process.env.BLACKBAUD_CLIENT_SECRET = "test-client-secret";
process.env.NEXT_PUBLIC_SITE_URL = "https://www.myteamnetwork.com";

// Encrypt a plaintext token using the same crypto path the module will use
const { encryptToken } = await import("../src/lib/blackbaud/oauth");

function makeIntegration(overrides: {
  id?: string;
  access_token_enc?: string;
  refresh_token_enc?: string;
  token_expires_at?: string;
}) {
  return {
    id: overrides.id ?? "int-1",
    access_token_enc: overrides.access_token_enc ?? encryptToken("current-access"),
    refresh_token_enc: overrides.refresh_token_enc ?? encryptToken("current-refresh"),
    token_expires_at: overrides.token_expires_at ?? new Date(Date.now() + 3600_000).toISOString(), // 1hr in future
  };
}

function makeFreshTokenResponse(
  accessToken: string,
  refreshToken: string,
  expiresIn: number = 3600
): string {
  return JSON.stringify({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn,
    token_type: "Bearer",
  });
}

// Minimal supabase stub factory
function makeSupabase(opts: {
  casUpdateCount?: number;
  reReadData?: { access_token_enc: string; token_expires_at?: string } | null;
  reReadError?: { message: string } | null;
  reReadSequence?: Array<{
    data: { access_token_enc: string; token_expires_at?: string } | null;
    error: { message: string } | null;
  }>;
} = {}) {
  const casUpdateCount = opts.casUpdateCount ?? 1;
  const reReadData = opts.reReadData !== undefined ? opts.reReadData : null;
  const reReadError = opts.reReadError ?? null;
  const reReadSequence = opts.reReadSequence ? [...opts.reReadSequence] : null;

  let updateCallCount = 0;
  let selectCallCount = 0;

  const supabase = {
    from: (table: string) => {
      void table;
      const chain: any = {
        select: (cols?: string, options?: any) => {
          void cols;
          void options;
          selectCallCount++;
          return chain;
        },
        update: (data: any) => {
          void data;
          return chain;
        },
        insert: () => chain,
        delete: () => chain,
        eq: () => chain,
        single: () => {
          // Re-read call (select after CAS miss)
          if (reReadSequence && reReadSequence.length > 0) {
            const next = reReadSequence.shift()!;
            return Promise.resolve(next);
          }
          return Promise.resolve({ data: reReadData, error: reReadError });
        },
        then: (resolve: any) => {
          // CAS update resolves with count
          updateCallCount++;
          return resolve({ count: casUpdateCount, error: null });
        },
      };
      return chain;
    },
  };

  return { supabase, getUpdateCallCount: () => updateCallCount, getSelectCallCount: () => selectCallCount };
}

describe("refreshTokenWithFallback", () => {
  beforeEach(() => {
    // Reset fetch mock to avoid cross-test contamination
    mock.restoreAll();
  });

  it("token not expired → returns decrypted token, never calls refreshAccessToken", async () => {
    const { refreshTokenWithFallback } = await import("../src/lib/blackbaud/token-refresh");

    let fetchCalled = false;
    // @ts-expect-error test override
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response("should not be called", { status: 200 });
    };

    const integration = makeIntegration({
      token_expires_at: new Date(Date.now() + 3600_000).toISOString(), // 1hr in future
      access_token_enc: encryptToken("my-access-token"),
    });

    const { supabase } = makeSupabase();
    const result = await refreshTokenWithFallback(integration, supabase);

    assert.equal(result, "my-access-token");
    assert.equal(fetchCalled, false, "fetch should not be called for non-expired token");
  });

  it("expired + CAS wins (count > 0) → returns newTokens.access_token", async () => {
    const { refreshTokenWithFallback } = await import("../src/lib/blackbaud/token-refresh");

    // @ts-expect-error test override
    globalThis.fetch = async (url: string, init: RequestInit) => {
      void url;
      void init;
      return new Response(makeFreshTokenResponse("new-access-token", "new-refresh-token"), {
        status: 200,
      });
    };

    const integration = makeIntegration({
      token_expires_at: new Date(Date.now() - 60_000).toISOString(), // expired 1min ago
      access_token_enc: encryptToken("old-access"),
      refresh_token_enc: encryptToken("old-refresh"),
    });

    const { supabase } = makeSupabase({ casUpdateCount: 1 });
    const result = await refreshTokenWithFallback(integration, supabase);

    assert.equal(result, "new-access-token");
  });

  it("CAS lost (count = 0) → re-reads DB, returns winner's token", async () => {
    const { refreshTokenWithFallback } = await import("../src/lib/blackbaud/token-refresh");

    // @ts-expect-error test override
    globalThis.fetch = async () => {
      return new Response(makeFreshTokenResponse("concurrent-access", "concurrent-refresh"), {
        status: 200,
      });
    };

    const winnersToken = encryptToken("winner-access-token");

    const integration = makeIntegration({
      token_expires_at: new Date(Date.now() - 60_000).toISOString(), // expired
    });

    const { supabase } = makeSupabase({
      casUpdateCount: 0,
      reReadData: { access_token_enc: winnersToken },
    });

    const result = await refreshTokenWithFallback(integration, supabase);

    assert.equal(result, "winner-access-token");
  });

  it("refreshAccessToken throws with invalid_grant → falls through to re-read DB", async () => {
    const { refreshTokenWithFallback } = await import("../src/lib/blackbaud/token-refresh");

    // Simulate Blackbaud returning invalid_grant (consumed refresh token)
    // @ts-expect-error test override
    globalThis.fetch = async () => {
      return new Response("invalid_grant: refresh token consumed", { status: 400 });
    };

    const winnersToken = encryptToken("winner-after-invalid-grant");

    const integration = makeIntegration({
      token_expires_at: new Date(Date.now() - 60_000).toISOString(), // expired
    });

    const { supabase } = makeSupabase({
      casUpdateCount: 0, // doesn't matter — won't reach CAS
      reReadData: { access_token_enc: winnersToken },
    });

    const result = await refreshTokenWithFallback(integration, supabase);

    assert.equal(result, "winner-after-invalid-grant");
  });

  it("waits for the winner's DB write instead of returning the stale expired token", async () => {
    const { refreshTokenWithFallback } = await import("../src/lib/blackbaud/token-refresh");

    // Simulate the loser hitting invalid_grant while the winner has not committed yet.
    // @ts-expect-error test override
    globalThis.fetch = async () => {
      return new Response("invalid_grant: refresh token consumed", { status: 400 });
    };

    const staleExpiry = new Date(Date.now() - 60_000).toISOString();
    const winnersToken = encryptToken("winner-after-race");

    const integration = makeIntegration({
      token_expires_at: staleExpiry,
      access_token_enc: encryptToken("stale-expired-access"),
    });

    const { supabase, getSelectCallCount } = makeSupabase({
      reReadSequence: [
        {
          data: {
            access_token_enc: integration.access_token_enc,
            token_expires_at: staleExpiry,
          },
          error: null,
        },
        {
          data: {
            access_token_enc: winnersToken,
            token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
          },
          error: null,
        },
      ],
    });

    const result = await refreshTokenWithFallback(integration, supabase);

    assert.equal(result, "winner-after-race");
    assert.equal(getSelectCallCount(), 2, "helper should retry until the winner token is visible");
  });

  it("re-read returns null data → throws descriptive error (not TypeError)", async () => {
    const { refreshTokenWithFallback } = await import("../src/lib/blackbaud/token-refresh");

    // @ts-expect-error test override
    globalThis.fetch = async () => {
      return new Response("invalid_grant: token consumed", { status: 400 });
    };

    const integration = makeIntegration({
      token_expires_at: new Date(Date.now() - 60_000).toISOString(), // expired
    });

    const { supabase } = makeSupabase({
      casUpdateCount: 0,
      reReadData: null,
      reReadError: null,
    });

    await assert.rejects(
      () => refreshTokenWithFallback(integration, supabase),
      (err: Error) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes("Token refresh failed"),
          `Expected descriptive error, got: ${err.message}`
        );
        assert.ok(
          err.message.includes("int-1"),
          `Expected integration id in error, got: ${err.message}`
        );
        return true;
      }
    );
  });

  it("re-read returns DB error → throws descriptive error", async () => {
    const { refreshTokenWithFallback } = await import("../src/lib/blackbaud/token-refresh");

    // @ts-expect-error test override
    globalThis.fetch = async () => {
      return new Response("invalid_grant: token consumed", { status: 400 });
    };

    const integration = makeIntegration({
      token_expires_at: new Date(Date.now() - 60_000).toISOString(), // expired
    });

    const { supabase } = makeSupabase({
      casUpdateCount: 0,
      reReadData: null,
      reReadError: { message: "connection timeout" },
    });

    await assert.rejects(
      () => refreshTokenWithFallback(integration, supabase),
      (err: Error) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes("Token refresh failed"),
          `Expected descriptive error, got: ${err.message}`
        );
        assert.ok(
          err.message.includes("connection timeout"),
          `Expected DB error message, got: ${err.message}`
        );
        return true;
      }
    );
  });
});
