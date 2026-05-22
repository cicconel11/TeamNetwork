import { describe, it } from "node:test";
import assert from "node:assert/strict";

type CapturedAlumniInsert = {
  first_name: string;
  last_name: string;
  email: string | null;
  phone_number: string | null;
  address_summary: string | null;
  graduation_year: number | null;
};

interface FakeSupabaseState {
  inserts: CapturedAlumniInsert[];
  syncLogUpdates: Record<string, unknown>[];
  integrationUpdates: Record<string, unknown>[];
}

function makeFakeSupabase(state: FakeSupabaseState) {
  return {
    from: (table: string) => {
      // chain methods are typed loose here on purpose — this is a test stub mirroring
      // the real supabase chain shape, not production code.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: () => chain,
        insert: (data: Record<string, unknown>) => {
          if (table === "alumni") {
            state.inserts.push(data as CapturedAlumniInsert);
          }
          return chain;
        },
        update: (data: Record<string, unknown>) => {
          if (table === "integration_sync_log") state.syncLogUpdates.push(data);
          if (table === "org_integrations") state.integrationUpdates.push(data);
          return chain;
        },
        delete: () => chain,
        eq: () => chain,
        is: () => chain,
        limit: () => chain,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single: () => {
          // For sync log insert + alumni insert, return a synthetic id.
          if (table === "alumni") {
            return Promise.resolve({ data: { id: `alumni-${state.inserts.length}` }, error: null });
          }
          return Promise.resolve({ data: { id: "sync-log-1" }, error: null });
        },
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: [], error: null }),
      };
      return chain;
    },
  };
}

describe("runSync sub-resource fetches", () => {
  it("fetches phones and addresses per constituent and persists them on alumni", async () => {
    const { runSync } = await import("../src/lib/blackbaud/sync");

    const paths: string[] = [];
    let constituentsPageCalls = 0;
    const fakeClient = {
      getList: async (path: string, params?: Record<string, string>) => {
        paths.push(path);
        if (path === "/constituent/v1/constituents") {
          // Health check uses limit=1; return empty so health passes without
          // surfacing a constituent that wouldn't get a sub-resource pass.
          if (params?.limit === "1") {
            return { count: 0, value: [] };
          }
          constituentsPageCalls += 1;
          if (constituentsPageCalls === 1) {
            return {
              count: 1,
              value: [
                { id: "c1", type: "Individual", first: "Ada", last: "Lovelace", class_of: "2010" },
              ],
            };
          }
          return { count: 0, value: [] };
        }
        if (path.endsWith("/emailaddresses")) {
          return {
            count: 1,
            value: [{ id: "e1", address: "ada@example.com", type: "Email", primary: true }],
          };
        }
        if (path.endsWith("/phones")) {
          return {
            count: 1,
            value: [{ id: "p1", number: "555-0100", type: "Mobile", primary: true }],
          };
        }
        if (path.endsWith("/addresses")) {
          return {
            count: 1,
            value: [
              {
                id: "a1",
                address_lines: "10 Computing Way",
                city: "London",
                state: "",
                postal_code: "EC1",
                country: "UK",
                type: "Home",
                primary: true,
              },
            ],
          };
        }
        return { count: 0, value: [] };
      },
    };

    const state: FakeSupabaseState = { inserts: [], syncLogUpdates: [], integrationUpdates: [] };
    const fakeSupabase = makeFakeSupabase(state);

    const result = await runSync({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: fakeClient as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      integrationId: "int-1",
      organizationId: "org-1",
      alumniLimit: null,
      currentAlumniCount: 0,
      syncType: "manual",
      lastSyncedAt: null,
    });

    assert.equal(result.ok, true);

    // Sub-resource paths fired for c1
    assert.ok(paths.some((p) => p === "/constituent/v1/constituents/c1/emailaddresses"), "emails fetched");
    assert.ok(paths.some((p) => p === "/constituent/v1/constituents/c1/phones"), "phones fetched");
    assert.ok(paths.some((p) => p === "/constituent/v1/constituents/c1/addresses"), "addresses fetched");

    // Alumni row carries all three
    assert.equal(state.inserts.length, 1);
    const inserted = state.inserts[0];
    assert.equal(inserted.first_name, "Ada");
    assert.equal(inserted.email, "ada@example.com");
    assert.equal(inserted.phone_number, "555-0100");
    assert.equal(inserted.address_summary, "10 Computing Way, London EC1");
    assert.equal(inserted.graduation_year, 2010);
  });

  it("continues on non-quota sub-resource failure and leaves field null", async () => {
    const { runSync } = await import("../src/lib/blackbaud/sync");

    const fakeClient = {
      getList: async (path: string) => {
        if (path === "/constituent/v1/constituents") {
          return {
            count: 1,
            value: [{ id: "c2", type: "Individual", first: "Grace", last: "Hopper" }],
          };
        }
        if (path.endsWith("?limit=1") || path.endsWith("/constituents") === false && path.includes("constituents") === false) {
          return { count: 0, value: [] };
        }
        if (path.endsWith("/emailaddresses")) {
          return { count: 1, value: [{ id: "e1", address: "grace@example.com", type: "Email", primary: true }] };
        }
        if (path.endsWith("/phones")) {
          // Non-quota failure
          throw new Error("Blackbaud API error (500) on /phones: server error");
        }
        if (path.endsWith("/addresses")) {
          return {
            count: 1,
            value: [
              {
                id: "a1",
                address_lines: "1 Yorktown",
                city: "Arlington",
                state: "VA",
                postal_code: "22202",
                country: "US",
                type: "Home",
                primary: true,
              },
            ],
          };
        }
        return { count: 0, value: [] };
      },
    };

    const state: FakeSupabaseState = { inserts: [], syncLogUpdates: [], integrationUpdates: [] };
    const fakeSupabase = makeFakeSupabase(state);

    const result = await runSync({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: fakeClient as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      integrationId: "int-2",
      organizationId: "org-1",
      alumniLimit: null,
      currentAlumniCount: 0,
      syncType: "manual",
      lastSyncedAt: null,
    });

    assert.equal(result.ok, true);
    assert.equal(state.inserts.length, 1);
    const inserted = state.inserts[0];
    assert.equal(inserted.email, "grace@example.com");
    assert.equal(inserted.phone_number, null, "phone null after non-quota fetch failure on insert");
    assert.equal(inserted.address_summary, "1 Yorktown, Arlington, VA 22202", "address still fetched");

    // R5 / U3: failure surfaces in skippedReasons + partial + warning.
    assert.equal(result.partial, true, "partial flag set when sub-resource failed");
    assert.equal(result.skippedReasons?.subresource_phones_failed, 1, "phones failure counted");
    assert.match(result.warning ?? "", /phones/i, "warning mentions failed resource");
  });

  it("preserves existing alumni email on UPDATE when /emailaddresses fetch fails (non-quota)", async () => {
    const { upsertConstituents } = await import("../src/lib/blackbaud/storage");

    // Existing alumni: imported previously, never user-edited, has real email
    // + phone. /emailaddresses 5xx this pass; phones + addresses returned
    // updated values. Storage must keep alumni.email, take the new phone +
    // first_name, NOT null-out email.
    const alumniUpdates: Record<string, unknown>[] = [];
    const externalDataUpdates: Record<string, unknown>[] = [];

    const fakeSupabase = {
      from: (table: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chain: any = {
          select: () => chain,
          insert: () => chain,
          update: (data: Record<string, unknown>) => {
            if (table === "alumni") alumniUpdates.push(data);
            if (table === "alumni_external_ids") externalDataUpdates.push(data);
            return chain;
          },
          delete: () => chain,
          eq: () => chain,
          is: () => chain,
          maybeSingle: () => {
            if (table === "alumni_external_ids") {
              return Promise.resolve({
                data: { id: "mapping-1", alumni_id: "alumni-1", last_synced_at: "2025-01-01T00:00:00Z" },
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          },
          single: () => {
            if (table === "alumni") {
              return Promise.resolve({
                data: {
                  id: "alumni-1",
                  first_name: "Old",
                  last_name: "Name",
                  email: "alum@example.com",
                  phone_number: "555-OLD",
                  address_summary: "Old Address",
                  graduation_year: 2010,
                  updated_at: "2025-01-01T00:00:00Z",
                },
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
        return chain;
      },
    };

    const result = await upsertConstituents(
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: fakeSupabase as any,
        integrationId: "int-update-1",
        organizationId: "org-1",
        alumniLimit: null,
        currentAlumniCount: 0,
      },
      [
        {
          external_id: "bb-1",
          first_name: "New",
          last_name: "Name",
          email: undefined, // emails sub-resource failed
          phone_number: "555-NEW",
          address_summary: "New Address",
          graduation_year: 2010,
          source: "integration_sync" as const,
        },
      ],
    );

    assert.equal(result.ok, true);
    assert.equal(result.updated, 1, "row updated, not skipped");
    assert.equal(alumniUpdates.length, 1);
    const update = alumniUpdates[0];

    // Critical assertion: email must NOT appear in the update (preserved).
    assert.equal(
      Object.prototype.hasOwnProperty.call(update, "email"),
      false,
      "email must not be overwritten when sub-resource fetch failed",
    );
    // Other fields did update.
    assert.equal(update.first_name, "New");
    assert.equal(update.phone_number, "555-NEW");
    assert.equal(update.address_summary, "New Address");

    // external_data snapshot keeps the previous email (last successful import).
    const snapshot = (externalDataUpdates[0] as { external_data: Record<string, unknown> }).external_data;
    assert.equal(snapshot.email, "alum@example.com", "snapshot preserves last successful email");
    assert.equal(snapshot.phone_number, "555-NEW", "snapshot reflects fresh phone");
  });

  it("nulls alumni email on UPDATE when /emailaddresses returns empty array (Blackbaud says no)", async () => {
    const { upsertConstituents } = await import("../src/lib/blackbaud/storage");

    const alumniUpdates: Record<string, unknown>[] = [];
    const fakeSupabase = {
      from: (table: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chain: any = {
          select: () => chain,
          insert: () => chain,
          update: (data: Record<string, unknown>) => {
            if (table === "alumni") alumniUpdates.push(data);
            return chain;
          },
          delete: () => chain,
          eq: () => chain,
          is: () => chain,
          maybeSingle: () => {
            if (table === "alumni_external_ids") {
              return Promise.resolve({
                data: { id: "mapping-2", alumni_id: "alumni-2", last_synced_at: "2025-01-01T00:00:00Z" },
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          },
          single: () => {
            if (table === "alumni") {
              return Promise.resolve({
                data: {
                  id: "alumni-2",
                  first_name: "X",
                  last_name: "Y",
                  email: "old@example.com",
                  phone_number: null,
                  address_summary: null,
                  graduation_year: null,
                  updated_at: "2025-01-01T00:00:00Z",
                },
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
        return chain;
      },
    };

    const result = await upsertConstituents(
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: fakeSupabase as any,
        integrationId: "int-update-2",
        organizationId: "org-1",
        alumniLimit: null,
        currentAlumniCount: 0,
      },
      [
        {
          external_id: "bb-2",
          first_name: "X",
          last_name: "Y",
          email: null, // Blackbaud successfully reported zero emails
          phone_number: null,
          address_summary: null,
          graduation_year: null,
          source: "integration_sync" as const,
        },
      ],
    );

    assert.equal(result.ok, true);
    assert.equal(alumniUpdates.length, 1);
    assert.equal(alumniUpdates[0].email, null, "explicit null overwrites — Blackbaud said zero");
  });

  it("propagates quota-exhausted error from a phones fetch and stops sync", async () => {
    const { runSync } = await import("../src/lib/blackbaud/sync");
    const { BlackbaudApiError } = await import("../src/lib/blackbaud/client");

    const fakeClient = {
      getList: async (path: string) => {
        if (path === "/constituent/v1/constituents") {
          return {
            count: 1,
            value: [{ id: "c3", type: "Individual", first: "Linus", last: "T" }],
          };
        }
        if (path.endsWith("/emailaddresses")) {
          return { count: 0, value: [] };
        }
        if (path.endsWith("/phones")) {
          throw new BlackbaudApiError(
            429,
            path,
            "Out of call volume quota. Quota will be replenished in 00:05:00.",
          );
        }
        return { count: 0, value: [] };
      },
    };

    const state: FakeSupabaseState = { inserts: [], syncLogUpdates: [], integrationUpdates: [] };
    const fakeSupabase = makeFakeSupabase(state);

    const result = await runSync({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: fakeClient as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      integrationId: "int-3",
      organizationId: "org-1",
      alumniLimit: null,
      currentAlumniCount: 0,
      syncType: "manual",
      lastSyncedAt: null,
    });

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /quota/i);
    // No alumni persisted — sync aborted mid-constituent
    assert.equal(state.inserts.length, 0);
    // Integration row recorded the structured quota failure
    const lastIntegrationUpdate = state.integrationUpdates.at(-1) ?? {};
    const syncErr = (lastIntegrationUpdate as { last_sync_error?: { code?: string } }).last_sync_error;
    assert.equal(syncErr?.code, "QUOTA_EXHAUSTED");
  });

  it("skips all sub-resources when BLACKBAUD_DEV_SKIP_EMAILS=true (dev gate)", async () => {
    const original = process.env.BLACKBAUD_DEV_SKIP_EMAILS;
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.BLACKBAUD_DEV_SKIP_EMAILS = "true";
    // Dev controls are gated off in production NODE_ENV — flip to development
    // via plain assignment (Node may freeze NODE_ENV's descriptor under some
    // loaders, so avoid defineProperty).
    process.env.NODE_ENV = "development";

    try {
      const { runSync } = await import("../src/lib/blackbaud/sync");

      const paths: string[] = [];
      let constituentsPageCalls = 0;
      const fakeClient = {
        getList: async (path: string, params?: Record<string, string>) => {
          paths.push(path);
          if (path === "/constituent/v1/constituents") {
            if (params?.limit === "1") {
              // Health check
              return { count: 0, value: [] };
            }
            constituentsPageCalls += 1;
            if (constituentsPageCalls === 1) {
              return {
                count: 1,
                value: [{ id: "c4", type: "Individual", first: "Skip", last: "Em" }],
              };
            }
            return { count: 0, value: [] };
          }
          return { count: 0, value: [] };
        },
      };

      const state: FakeSupabaseState = { inserts: [], syncLogUpdates: [], integrationUpdates: [] };
      const fakeSupabase = makeFakeSupabase(state);

      const result = await runSync({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client: fakeClient as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: fakeSupabase as any,
        integrationId: "int-4",
        organizationId: "org-1",
        alumniLimit: null,
        currentAlumniCount: 0,
        syncType: "manual",
        lastSyncedAt: null,
      });

      assert.equal(result.ok, true);
      // Constituent still upserted with empty sub-resources
      assert.equal(state.inserts.length, 1);
      assert.equal(state.inserts[0].phone_number, null);
      assert.equal(state.inserts[0].address_summary, null);
      assert.equal(state.inserts[0].email, null);
      // No sub-resource fetches fired
      assert.ok(!paths.some((p) => p.endsWith("/phones")), "no /phones fetch");
      assert.ok(!paths.some((p) => p.endsWith("/addresses")), "no /addresses fetch");
      assert.ok(!paths.some((p) => p.endsWith("/emailaddresses")), "no /emailaddresses fetch");
    } finally {
      if (original === undefined) delete process.env.BLACKBAUD_DEV_SKIP_EMAILS;
      else process.env.BLACKBAUD_DEV_SKIP_EMAILS = original;
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
