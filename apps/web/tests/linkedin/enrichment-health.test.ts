/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "../utils/supabaseStub.ts";
import {
  checkEnrichmentHealth,
  summarizeEnrichmentHealthGlobal,
} from "../../src/lib/linkedin/enrichment-health.ts";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const NOW = Date.parse("2026-06-15T12:00:00.000Z");

test("checkEnrichmentHealth reports ok when tagging is healthy", async () => {
  const stub = createSupabaseStub();
  stub.seed("members", [
    { id: "m1", organization_id: ORG_ID, user_id: "u1", deleted_at: null },
  ]);
  stub.seed("alumni", [
    {
      id: "a1",
      organization_id: ORG_ID,
      user_id: "u1",
      enrichment_status: "enriched",
      enrichment_retry_count: 0,
      enrichment_filled_fields: ["job_title"],
      deleted_at: null,
    },
  ]);

  const report = await checkEnrichmentHealth(stub as any, ORG_ID, { now: NOW });

  assert.equal(report.state, "ok");
  assert.deepEqual(report.counts, {
    userlessRows: 0,
    permanentlyFailed: 0,
    stalledRuns: 0,
    preProvenance: 0,
  });
});

test("checkEnrichmentHealth flags userless member rows", async () => {
  const stub = createSupabaseStub();
  stub.seed("members", [
    { id: "m-linked", organization_id: ORG_ID, user_id: "u1", deleted_at: null },
    { id: "m-userless", organization_id: ORG_ID, user_id: null, deleted_at: null },
    { id: "m-deleted", organization_id: ORG_ID, user_id: null, deleted_at: "2026-01-01T00:00:00.000Z" },
  ]);

  const report = await checkEnrichmentHealth(stub as any, ORG_ID, { now: NOW });

  assert.equal(report.state, "gaps");
  assert.deepEqual(report.userlessRows, ["m-userless"]);
});

test("checkEnrichmentHealth flags alumni with exhausted retries as permanently failed", async () => {
  const stub = createSupabaseStub();
  stub.seed("alumni", [
    { id: "a-failed", organization_id: ORG_ID, enrichment_status: "failed", enrichment_retry_count: 3, deleted_at: null },
    { id: "a-retrying", organization_id: ORG_ID, enrichment_status: "failed", enrichment_retry_count: 1, deleted_at: null },
  ]);

  const report = await checkEnrichmentHealth(stub as any, ORG_ID, { now: NOW });

  assert.equal(report.counts.permanentlyFailed, 1);
  assert.deepEqual(report.permanentlyFailed, ["a-failed"]);
});

test("checkEnrichmentHealth flags enrichment runs stuck past the hard timeout", async () => {
  const stub = createSupabaseStub();
  stub.seed("linkedin_enrichment_runs", [
    { id: "run-stuck", organization_id: ORG_ID, status: "syncing", updated_at: "2026-06-15T09:00:00.000Z" },
    { id: "run-recent", organization_id: ORG_ID, status: "syncing", updated_at: "2026-06-15T11:30:00.000Z" },
    { id: "run-done", organization_id: ORG_ID, status: "enriched", updated_at: "2026-06-15T01:00:00.000Z" },
  ]);

  // NOW is 12:00; hard cutoff is 10:00. Only run-stuck (09:00) is past it.
  const report = await checkEnrichmentHealth(stub as any, ORG_ID, { now: NOW });

  assert.equal(report.counts.stalledRuns, 1);
  assert.deepEqual(report.stalledRuns, ["run-stuck"]);
});

test("checkEnrichmentHealth flags enriched rows with no provenance array", async () => {
  const stub = createSupabaseStub();
  stub.seed("alumni", [
    { id: "a-old", organization_id: ORG_ID, enrichment_status: "enriched", enrichment_retry_count: 0, enrichment_filled_fields: null, deleted_at: null },
    { id: "a-new", organization_id: ORG_ID, enrichment_status: "enriched", enrichment_retry_count: 0, enrichment_filled_fields: ["job_title"], deleted_at: null },
  ]);

  const report = await checkEnrichmentHealth(stub as any, ORG_ID, { now: NOW });

  assert.equal(report.counts.preProvenance, 1);
  assert.deepEqual(report.preProvenance, ["a-old"]);
});

test("checkEnrichmentHealth degrades when a source query fails", async () => {
  const stub = createSupabaseStub();
  stub.simulateError("alumni", { message: "db down" });

  const report = await checkEnrichmentHealth(stub as any, ORG_ID, { now: NOW });

  assert.equal(report.state, "degraded");
  assert.equal(report.reason, "db down");
});

// --- U8: cross-org cron summary ---

test("summarizeEnrichmentHealthGlobal aggregates problem counts across orgs", async () => {
  const stub = createSupabaseStub();
  const OTHER_ORG = "22222222-2222-2222-2222-222222222222";
  stub.seed("members", [
    { id: "m1", organization_id: ORG_ID, user_id: null, deleted_at: null },
    { id: "m2", organization_id: OTHER_ORG, user_id: null, deleted_at: null },
    { id: "m3", organization_id: ORG_ID, user_id: "u", deleted_at: null },
  ]);
  stub.seed("alumni", [
    { id: "a1", organization_id: ORG_ID, enrichment_status: "failed", enrichment_retry_count: 3, deleted_at: null },
    { id: "a2", organization_id: OTHER_ORG, enrichment_status: "enriched", enrichment_retry_count: 0, enrichment_filled_fields: null, deleted_at: null },
  ]);
  stub.seed("linkedin_enrichment_runs", [
    { id: "r1", organization_id: ORG_ID, status: "syncing", updated_at: "2026-06-15T09:00:00.000Z" },
  ]);

  const summary = await summarizeEnrichmentHealthGlobal(stub as any, { now: NOW });

  assert.deepEqual(summary, {
    userlessRows: 2,
    permanentlyFailed: 1,
    stalledRuns: 1,
    preProvenance: 1,
  });
});

test("summarizeEnrichmentHealthGlobal reports zeros when nothing is wrong", async () => {
  const stub = createSupabaseStub();
  stub.seed("members", [{ id: "m", organization_id: ORG_ID, user_id: "u", deleted_at: null }]);

  const summary = await summarizeEnrichmentHealthGlobal(stub as any, { now: NOW });

  assert.deepEqual(summary, {
    userlessRows: 0,
    permanentlyFailed: 0,
    stalledRuns: 0,
    preProvenance: 0,
  });
});
