import test from "node:test";
import assert from "node:assert/strict";
import { createEnrichmentProcessGetHandler } from "@/app/api/cron/enrichment-process/handler";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

test("hard-timeout failures clear source alumni and user sync state", async () => {
  const supabase = createSupabaseStub();
  const old = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const alumniId = "11111111-1111-4111-8111-111111111111";
  const userId = "22222222-2222-4222-8222-222222222222";
  let retryParams: Record<string, unknown> | null = null;

  supabase.seed("linkedin_enrichment_runs", [
    {
      id: "33333333-3333-4333-8333-333333333333",
      run_id: "run_alumni",
      target_kind: "alumni",
      alumni_id: alumniId,
      organization_id: "44444444-4444-4444-8444-444444444444",
      linkedin_url: "https://www.linkedin.com/in/alum",
      status: "syncing",
      created_at: old,
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      run_id: "run_user",
      target_kind: "user",
      user_id: userId,
      linkedin_url: "https://www.linkedin.com/in/member",
      status: "syncing",
      created_at: old,
    },
  ]);
  supabase.seed("alumni", [
    {
      id: alumniId,
      organization_id: "44444444-4444-4444-8444-444444444444",
      linkedin_url: "https://www.linkedin.com/in/alum",
      enrichment_status: "syncing",
      enrichment_retry_count: 0,
      deleted_at: null,
    },
  ]);
  supabase.seed("user_linkedin_connections", [
    {
      user_id: userId,
      enrichment_status: "syncing",
      enrichment_run_id: "run_user",
      sync_error: null,
    },
  ]);
  supabase.registerRpc("increment_enrichment_retry", (params) => {
    retryParams = params;
    for (const id of params.p_alumni_ids as string[]) {
      const row = supabase.getRows("alumni").find((alumni) => alumni.id === id);
      assert.ok(row);
    }
    return { success: true };
  });

  const handler = createEnrichmentProcessGetHandler({
    createServiceClient: () => supabase as never,
    validateCronAuth: () => null,
    isApifyConfigured: () => true,
    getApifyRunStatus: async () => "RUNNING",
    processFinishedApifyRun: async () => {
      throw new Error("terminal reconciliation should not run");
    },
  });

  const response = await handler(new Request("https://example.com/api/cron/enrichment-process"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.hard_timed_out, 2);
  assert.deepEqual(retryParams, {
    p_alumni_ids: [alumniId],
    p_error: "timed_out",
    p_max_retries: 3,
  });
  assert.deepEqual(
    supabase.getRows("linkedin_enrichment_runs").map((row) => ({
      id: row.id,
      status: row.status,
      error: row.error,
    })),
    [
      {
        id: "33333333-3333-4333-8333-333333333333",
        status: "failed",
        error: "timed_out",
      },
      {
        id: "55555555-5555-4555-8555-555555555555",
        status: "failed",
        error: "timed_out",
      },
    ],
  );
  assert.deepEqual(supabase.getRows("user_linkedin_connections")[0], {
    id: supabase.getRows("user_linkedin_connections")[0].id,
    created_at: supabase.getRows("user_linkedin_connections")[0].created_at,
    updated_at: supabase.getRows("user_linkedin_connections")[0].updated_at,
    user_id: userId,
    enrichment_status: "failed",
    enrichment_run_id: null,
    sync_error: "timed_out",
  });
});
