import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("chunkArray", () => {
  it("splits into correct chunks", async () => {
    const { chunkArray } = await import("../src/lib/blackbaud/storage");
    const items = [1, 2, 3, 4, 5];
    const chunks = chunkArray(items, 2);
    assert.deepEqual(chunks, [[1, 2], [3, 4], [5]]);
  });

  it("handles empty array", async () => {
    const { chunkArray } = await import("../src/lib/blackbaud/storage");
    assert.deepEqual(chunkArray([], 10), []);
  });

  it("handles chunk size larger than array", async () => {
    const { chunkArray } = await import("../src/lib/blackbaud/storage");
    assert.deepEqual(chunkArray([1, 2], 10), [[1, 2]]);
  });

  it("handles chunk size of 1", async () => {
    const { chunkArray } = await import("../src/lib/blackbaud/storage");
    assert.deepEqual(chunkArray([1, 2, 3], 1), [[1], [2], [3]]);
  });
});

describe("upsertConstituents — soft-deleted alumni", () => {
  it("deletes stale mapping and creates new alumni when linked alumni is soft-deleted", async () => {
    const { upsertConstituents } = await import("../src/lib/blackbaud/storage");

    const deletedMappingIds: string[] = [];
    const insertedAlumni: any[] = [];
    const insertedMappings: any[] = [];

    // Track which table operations happen
    const fakeSupabase = {
      from: (table: string) => {
        const chain: any = {
          select: () => chain,
          insert: (data: any) => {
            if (table === "alumni") insertedAlumni.push(data);
            if (table === "alumni_external_ids") insertedMappings.push(data);
            return chain;
          },
          update: () => chain,
          delete: () => {
            return {
              eq: (...args: [string, string]) => {
                const val = args[1];
                if (table === "alumni_external_ids") deletedMappingIds.push(val);
                return Promise.resolve({ error: null });
              },
            };
          },
          eq: () => chain,
          is: () => chain,
          maybeSingle: () => {
            if (table === "alumni_external_ids") {
              // Existing mapping found
              return Promise.resolve({
                data: { id: "mapping-1", alumni_id: "alumni-1", last_synced_at: "2025-01-01T00:00:00Z" },
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          },
          single: () => {
            if (table === "alumni") {
              // First call (in the mapping branch): alumni is soft-deleted (null)
              // Second call (in the create branch): new alumni created
              if (insertedAlumni.length > 0) {
                return Promise.resolve({ data: { id: "alumni-new" }, error: null });
              }
              return Promise.resolve({ data: null, error: { message: "not found", code: "PGRST116" } });
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
        return chain;
      },
    };

    const result = await upsertConstituents(
      {
        supabase: fakeSupabase as any,
        integrationId: "int-1",
        organizationId: "org-1",
        alumniLimit: null,
        currentAlumniCount: 0,
      },
      [{
        external_id: "bb-123",
        first_name: "Jane",
        last_name: "Doe",
        email: "jane@example.com",
        phone_number: null,
        address_summary: null,
        graduation_year: 2020,
        source: "integration_sync" as const,
      }]
    );

    // Stale mapping should have been deleted
    assert.ok(deletedMappingIds.length > 0, "should delete stale mapping");
    assert.equal(deletedMappingIds[0], "mapping-1");

    // New alumni should have been created
    assert.ok(insertedAlumni.length > 0, "should create new alumni record");
    assert.equal(insertedAlumni[0].first_name, "Jane");

    // Result should show created, not unchanged
    assert.equal(result.created, 1);
    assert.equal(result.unchanged, 0);
  });

  it("skips record and preserves mapping on transient DB error (non-PGRST116)", async () => {
    const { upsertConstituents } = await import("../src/lib/blackbaud/storage");

    const deletedMappingIds: string[] = [];
    const insertedAlumni: any[] = [];

    const fakeSupabase = {
      from: (table: string) => {
        const chain: any = {
          select: () => chain,
          insert: (data: any) => {
            if (table === "alumni") insertedAlumni.push(data);
            return chain;
          },
          update: () => chain,
          delete: () => {
            return {
              eq: (...args: [string, string]) => {
                const val = args[1];
                if (table === "alumni_external_ids") deletedMappingIds.push(val);
                return Promise.resolve({ error: null });
              },
            };
          },
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
              // Transient DB error — NOT PGRST116
              return Promise.resolve({ data: null, error: { message: "connection timeout", code: "57014" } });
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
        return chain;
      },
    };

    const result = await upsertConstituents(
      {
        supabase: fakeSupabase as any,
        integrationId: "int-1",
        organizationId: "org-1",
        alumniLimit: null,
        currentAlumniCount: 0,
      },
      [{
        external_id: "bb-456",
        first_name: "John",
        last_name: "Smith",
        email: "john@example.com",
        phone_number: null,
        address_summary: null,
        graduation_year: 2018,
        source: "integration_sync" as const,
      }]
    );

    // Mapping should NOT have been deleted
    assert.equal(deletedMappingIds.length, 0, "should not delete mapping on transient error");

    // No new alumni should have been created
    assert.equal(insertedAlumni.length, 0, "should not create new alumni on transient error");

    // Record should be skipped
    assert.equal(result.skipped, 1);
    assert.equal(result.created, 0);
    assert.equal(result.unchanged, 0);
  });
});
