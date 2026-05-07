import test from "node:test";
import assert from "node:assert/strict";

const { createEnrichmentProcessGetHandler } = await import(
  "../../../src/app/api/cron/enrichment-process/handler.ts"
);

type StubFilter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "lt"; column: string; value: unknown }
  | { kind: "gte"; column: string; value: unknown }
  | { kind: "not-null"; column: string; value: unknown }
  | { kind: "is-null"; column: string; value: unknown };

function createSupabaseStub(initialAlumni: Array<Record<string, unknown>>) {
  const state = {
    alumni: [...initialAlumni],
    rpcCalls: [] as Array<{ name: string; params: Record<string, unknown> }>,
    enrichmentCalls: [] as Array<Record<string, unknown>>,
  };

  function applyFilters(rows: Array<Record<string, unknown>>, filters: StubFilter[]) {
    return rows.filter((row) =>
      filters.every((filter) => {
        if (filter.kind === "eq") return row[filter.column] === filter.value;
        if (filter.kind === "lt") return Number(row[filter.column] ?? 0) < Number(filter.value);
        if (filter.kind === "gte") return Number(row[filter.column] ?? 0) >= Number(filter.value);
        if (filter.kind === "not-null") return row[filter.column] !== null && row[filter.column] !== undefined;
        if (filter.kind === "is-null") return row[filter.column] === null;
        return true;
      })
    );
  }

  function from(table: string) {
    const query = {
      filters: [] as StubFilter[],
      updates: null as Record<string, unknown> | null,
      limitValue: null as number | null,
    };

    const builder: {
      select: () => typeof builder;
      update: (payload: Record<string, unknown>) => typeof builder;
      eq: (column: string, value: unknown) => typeof builder;
      is: (column: string, value: unknown) => typeof builder;
      not: (column: string, operator: string, value: unknown) => typeof builder;
      lt: (column: string, value: unknown) => typeof builder;
      gte: (column: string, value: unknown) => typeof builder;
      limit: (value: number) => typeof builder;
      in: (column: string, values: unknown[]) => typeof builder | Promise<{ data: null; error: null }>;
      then: (
        onFulfilled: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => Promise<unknown>;
    } = {
      select() {
        return builder;
      },
      update(payload: Record<string, unknown>) {
        query.updates = payload;
        return builder;
      },
      eq(column: string, value: unknown) {
        query.filters.push({ kind: "eq", column, value });
        return builder;
      },
      is(column: string, value: unknown) {
        query.filters.push({ kind: value === null ? "is-null" : "eq", column, value });
        return builder;
      },
      not(column: string, operator: string, value: unknown) {
        if (operator === "is" && value === null) {
          query.filters.push({ kind: "not-null", column, value });
        }
        return builder;
      },
      lt(column: string, value: unknown) {
        query.filters.push({ kind: "lt", column, value });
        return builder;
      },
      gte(column: string, value: unknown) {
        query.filters.push({ kind: "gte", column, value });
        return builder;
      },
      limit(value: number) {
        query.limitValue = value;
        return builder;
      },
      in(column: string, values: unknown[]) {
        if (table === "alumni" && query.updates) {
          for (const row of state.alumni) {
            if (values.includes(row[column])) {
              Object.assign(row, query.updates);
            }
          }
          return Promise.resolve({ data: null, error: null });
        }
        return builder;
      },
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        if (table !== "alumni") {
          return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
        }

        if (query.updates) {
          for (const row of applyFilters(state.alumni, query.filters)) {
            Object.assign(row, query.updates);
          }
          return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
        }

        const rows = applyFilters(state.alumni, query.filters);
        const limited = query.limitValue ? rows.slice(0, query.limitValue) : rows;
        return Promise.resolve({ data: limited, error: null }).then(onFulfilled, onRejected);
      },
    };

    return builder;
  }

  return {
    from,
    rpc: async (name: string, params: Record<string, unknown>) => {
      state.rpcCalls.push({ name, params });
      if (name === "increment_enrichment_retry") {
        return { data: null, error: null };
      }
      if (name === "enrich_alumni_by_id") {
        state.enrichmentCalls.push(params);
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
    state,
  };
}

test("enrichment-process short-circuits cleanly when Bright Data is not configured", async () => {
  const GET = createEnrichmentProcessGetHandler({
    validateCronAuth: () => null,
    isBrightDataConfigured: () => false,
  });

  const response = await GET(new Request("http://localhost/api/cron/enrichment-process"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    skipped: "bright_data_not_configured",
  });
});

test("enrichment-process enriches pending alumni with the current Bright Data helper API", async () => {
  const supabase = createSupabaseStub([
    {
      id: "alumni-1",
      organization_id: "org-1",
      linkedin_url: "https://www.linkedin.com/in/jane-doe/",
      enrichment_retry_count: 0,
      enrichment_snapshot_id: "legacy-snapshot-id",
      enrichment_status: "pending",
      deleted_at: null,
    },
  ]);

  const GET = createEnrichmentProcessGetHandler({
    validateCronAuth: () => null,
    createServiceClient: () => supabase as ReturnType<typeof createSupabaseStub>,
    isBrightDataConfigured: () => true,
    fetchBrightDataProfile: async () => ({
      ok: true as const,
      profile: {
        name: "Jane Doe",
        city: "Austin",
        position: null,
        current_company: null,
        current_company_name: "Acme",
        experience: [{ title: "Product Manager", company: "Acme", location: "Austin", end_date: null }],
        education: [{ school: "Penn", field_of_study: "Economics" }],
      },
    }),
    mapBrightDataToFields: () => ({
      job_title: "Product Manager",
      current_company: "Acme",
      industry: null,
      current_city: "Austin",
      school: "Penn",
      major: "Economics",
      position_title: "Product Manager",
    }),
  });

  const response = await GET(new Request("http://localhost/api/cron/enrichment-process"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    enriched: 1,
    failed: 0,
    processed: 1,
  });

  assert.equal(supabase.state.enrichmentCalls.length, 1);
  assert.deepEqual(supabase.state.enrichmentCalls[0], {
    p_alumni_id: "alumni-1",
    p_organization_id: "org-1",
    p_job_title: "Product Manager",
    p_current_company: "Acme",
    p_current_city: "Austin",
    p_school: "Penn",
    p_major: "Economics",
    p_position_title: "Product Manager",
    p_headline: null,
    p_summary: null,
    p_work_history: null,
    p_education_history: null,
  });
  assert.equal(supabase.state.alumni[0].enrichment_snapshot_id, null);
});

test("enrichment-process increments retry on Bright Data fetch failure", async () => {
  const supabase = createSupabaseStub([
    {
      id: "alumni-2",
      organization_id: "org-1",
      linkedin_url: "https://www.linkedin.com/in/john-doe/",
      enrichment_retry_count: 1,
      enrichment_snapshot_id: null,
      enrichment_status: "pending",
      deleted_at: null,
    },
  ]);

  const GET = createEnrichmentProcessGetHandler({
    validateCronAuth: () => null,
    createServiceClient: () => supabase as ReturnType<typeof createSupabaseStub>,
    isBrightDataConfigured: () => true,
    fetchBrightDataProfile: async () => null,
  });

  const response = await GET(new Request("http://localhost/api/cron/enrichment-process"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    enriched: 0,
    failed: 1,
    processed: 1,
  });

  assert.equal(supabase.state.rpcCalls.length, 1);
  assert.deepEqual(supabase.state.rpcCalls[0], {
    name: "increment_enrichment_retry",
    params: {
      p_alumni_ids: ["alumni-2"],
      p_error: "bright_data_fetch_failed",
      p_max_retries: 3,
    },
  });
});
