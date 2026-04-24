/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

const ORIGINAL_ENV = {
  BLACKBAUD_DEV_PAGE_SIZE: process.env.BLACKBAUD_DEV_PAGE_SIZE,
  BLACKBAUD_DEV_MAX_PAGES: process.env.BLACKBAUD_DEV_MAX_PAGES,
  BLACKBAUD_DEV_SKIP_EMAILS: process.env.BLACKBAUD_DEV_SKIP_EMAILS,
  NODE_ENV: process.env.NODE_ENV,
};

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function makeWriteableSyncSupabase(onUpdate?: (table: string, data: Record<string, unknown>) => void) {
  let alumniId = 0;

  return {
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        insert: () => chain,
        update: (data: Record<string, unknown>) => {
          onUpdate?.(table, data);
          return chain;
        },
        delete: () => chain,
        eq: () => chain,
        is: () => chain,
        limit: () => chain,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single: () => {
          if (table === "integration_sync_log") {
            return Promise.resolve({ data: { id: "sync-log-1" }, error: null });
          }
          if (table === "alumni") {
            alumniId += 1;
            return Promise.resolve({ data: { id: `alumni-${alumniId}` }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: [], error: null }),
      };
      return chain;
    },
  };
}

describe("runSync health preflight", () => {
  it("fails before pagination and persists verify failures", async () => {
    const { runSync } = await import("../src/lib/blackbaud/sync");

    const clientCalls: Array<{ path: string; params?: Record<string, string> }> = [];
    let syncLogUpdate: Record<string, unknown> | null = null;
    let integrationUpdate: Record<string, unknown> | null = null;

    const fakeClient = {
      getList: async (path: string, params?: Record<string, string>) => {
        clientCalls.push({ path, params });
        throw new Error(`Blackbaud API error (401) on ${path}: Unauthorized`);
      },
    };

    const fakeSupabase = {
      from: (table: string) => {
        const chain: any = {
          select: () => chain,
          insert: () => chain,
          update: (data: Record<string, unknown>) => {
            if (table === "integration_sync_log") {
              syncLogUpdate = data;
            }
            if (table === "org_integrations") {
              integrationUpdate = data;
            }
            return chain;
          },
          eq: () => chain,
          limit: () => chain,
          single: () => Promise.resolve({ data: { id: "sync-log-1" }, error: null }),
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
            resolve({ data: [], error: null }),
        };
        return chain;
      },
    };

    const result = await runSync({
      client: fakeClient as any,
      supabase: fakeSupabase as any,
      integrationId: "int-1",
      organizationId: "org-1",
      alumniLimit: null,
      currentAlumniCount: 0,
      syncType: "manual",
      lastSyncedAt: null,
    });

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /health check failed/i);
    assert.deepEqual(clientCalls, [
      {
        path: "/constituent/v1/constituents",
        params: { limit: "1" },
      },
    ]);
    assert.equal(syncLogUpdate?.status, "failed");
    assert.match(String(syncLogUpdate?.error_message ?? ""), /health check failed/i);
    assert.equal((integrationUpdate?.last_sync_error as { phase?: string } | null)?.phase, "api_verify");
    assert.match(
      String((integrationUpdate?.last_sync_error as { message?: string } | null)?.message ?? ""),
      /health check failed/i
    );
  });

  it("runs the preflight once and then continues with pagination for healthy credentials", async () => {
    const { runSync } = await import("../src/lib/blackbaud/sync");

    const clientCalls: Array<{ path: string; params?: Record<string, string> }> = [];

    const fakeClient = {
      getList: async (path: string, params?: Record<string, string>) => {
        clientCalls.push({ path, params });

        if (params?.limit === "1") {
          return { count: 0, value: [] };
        }

        return { count: 0, value: [] };
      },
    };

    const fakeSupabase = {
      from: (tableName: string) => {
        void tableName;
        const chain: any = {
          select: () => chain,
          insert: () => chain,
          update: () => chain,
          delete: () => chain,
          eq: () => chain,
          is: () => chain,
          limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          single: () => Promise.resolve({ data: { id: "sync-log-1" }, error: null }),
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
            resolve({ data: [], error: null }),
        };
        return chain;
      },
    };

    const result = await runSync({
      client: fakeClient as any,
      supabase: fakeSupabase as any,
      integrationId: "int-1",
      organizationId: "org-1",
      alumniLimit: null,
      currentAlumniCount: 0,
      syncType: "incremental",
      lastSyncedAt: null,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(clientCalls, [
      {
        path: "/constituent/v1/constituents",
        params: { limit: "1" },
      },
      {
        path: "/constituent/v1/constituents",
        params: { limit: "500", offset: "0" },
      },
    ]);
  });

  it("honors valid dev throttle values, skips email calls, and does not advance cursor on a partial page cap", async () => {
    process.env.NODE_ENV = "development";
    process.env.BLACKBAUD_DEV_PAGE_SIZE = "50";
    process.env.BLACKBAUD_DEV_MAX_PAGES = "1";
    process.env.BLACKBAUD_DEV_SKIP_EMAILS = "true";

    const { runSync } = await import("../src/lib/blackbaud/sync");

    const clientCalls: Array<{ path: string; params?: Record<string, string> }> = [];
    let integrationUpdate: Record<string, unknown> | null = null;

    const fakeClient = {
      getList: async (path: string, params?: Record<string, string>) => {
        clientCalls.push({ path, params });

        if (params?.limit === "1") {
          return { count: 1, value: [] };
        }

        return {
          count: 100,
          value: Array.from({ length: Number(params?.limit ?? 0) }, (_, index) => ({
            id: `c-${index}`,
            type: "Individual",
            first: "A",
            last: `B${index}`,
          })),
        };
      },
    };

    const result = await runSync({
      client: fakeClient as any,
      supabase: makeWriteableSyncSupabase((table, data) => {
        if (table === "org_integrations") integrationUpdate = data;
      }) as any,
      integrationId: "int-1",
      organizationId: "org-1",
      alumniLimit: null,
      currentAlumniCount: 0,
      syncType: "manual",
      lastSyncedAt: null,
    });

    assert.equal(result.ok, true);
    assert.equal(result.created, 50);
    assert.equal(result.partial, true);
    assert.match(result.warning ?? "", /BLACKBAUD_DEV_MAX_PAGES/);
    assert.equal(integrationUpdate?.last_synced_at, undefined);
    assert.deepEqual(clientCalls, [
      { path: "/constituent/v1/constituents", params: { limit: "1" } },
      { path: "/constituent/v1/constituents", params: { limit: "50", offset: "0" } },
    ]);
  });

  it("falls back to safe defaults for invalid dev throttle values", async () => {
    process.env.NODE_ENV = "development";
    process.env.BLACKBAUD_DEV_PAGE_SIZE = "abc";
    process.env.BLACKBAUD_DEV_MAX_PAGES = "abc";
    process.env.BLACKBAUD_DEV_SKIP_EMAILS = "true";

    const { runSync } = await import("../src/lib/blackbaud/sync");

    const clientCalls: Array<{ path: string; params?: Record<string, string> }> = [];

    const fakeClient = {
      getList: async (path: string, params?: Record<string, string>) => {
        clientCalls.push({ path, params });

        if (params?.limit === "1") {
          return { count: 1, value: [] };
        }

        if (params?.offset === "0") {
          return {
            count: 501,
            value: [{ id: "c-1", type: "Individual", first: "A", last: "B" }],
          };
        }

        return { count: 501, value: [] };
      },
    };

    const result = await runSync({
      client: fakeClient as any,
      supabase: makeWriteableSyncSupabase() as any,
      integrationId: "int-1",
      organizationId: "org-1",
      alumniLimit: null,
      currentAlumniCount: 0,
      syncType: "manual",
      lastSyncedAt: null,
    });

    assert.equal(result.ok, true);
    assert.equal(result.partial, undefined);
    assert.deepEqual(clientCalls, [
      { path: "/constituent/v1/constituents", params: { limit: "1" } },
      { path: "/constituent/v1/constituents", params: { limit: "500", offset: "0" } },
    ]);
  });
});
