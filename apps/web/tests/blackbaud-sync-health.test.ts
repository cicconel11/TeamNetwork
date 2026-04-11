/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

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
});
