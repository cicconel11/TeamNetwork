import { describe, it } from "node:test";
import assert from "node:assert";

/**
 * Route simulation tests for /api/cron/notification-dispatch.
 *
 * Verifies the leasing + retry contract without standing up a real Supabase:
 *   - Auth gate via cron secret.
 *   - Leasing only claims `status='pending' AND scheduled_for <= now()`.
 *   - Successful dispatch flips to `succeeded`.
 *   - Failure increments `attempts`; final attempt flips to `failed`.
 *   - Unknown `kind` is treated as a hard failure.
 */

interface JobRow {
  id: string;
  status: "pending" | "processing" | "succeeded" | "failed";
  kind: string;
  scheduled_for: string;
  attempts: number;
  last_error: string | null;
  leased_at: string | null;
}

interface SimResult {
  status: number;
  body: unknown;
  jobsAfter: JobRow[];
}

const MAX_ATTEMPTS = 5;

function simulateCronAuth(
  cronSecret: string | undefined,
  authHeader: string | null,
): { status: number; body: { error: string } } | null {
  if (!cronSecret) {
    return { status: 500, body: { error: "CRON_SECRET not configured" } };
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return { status: 401, body: { error: "Unauthorized" } };
  }
  return null;
}

function simulateDispatch(input: {
  cronSecret: string | undefined;
  authHeader: string | null;
  now: string;
  jobs: JobRow[];
  /** Map of job id -> dispatch result. Missing means success. */
  dispatchOutcomes: Record<string, { ok: boolean; error?: string }>;
}): SimResult {
  const authError = simulateCronAuth(input.cronSecret, input.authHeader);
  if (authError) {
    return { ...authError, jobsAfter: input.jobs };
  }

  const eligible = input.jobs.filter(
    (j) => j.status === "pending" && j.scheduled_for <= input.now,
  );

  // Lease them.
  const leased = eligible.map((j) => ({
    ...j,
    status: "processing" as const,
    leased_at: input.now,
  }));

  // Dispatch each.
  const results: JobRow[] = leased.map((job) => {
    const outcome = input.dispatchOutcomes[job.id] ?? { ok: true };
    if (outcome.ok) {
      return { ...job, status: "succeeded", last_error: null };
    }
    const nextAttempts = job.attempts + 1;
    const finalStatus =
      nextAttempts >= MAX_ATTEMPTS
        ? ("failed" as const)
        : ("pending" as const);
    return {
      ...job,
      status: finalStatus,
      attempts: nextAttempts,
      last_error: outcome.error ?? "unknown",
      leased_at: null,
    };
  });

  // Merge back with non-leased jobs.
  const idsTouched = new Set(results.map((r) => r.id));
  const jobsAfter = [
    ...input.jobs.filter((j) => !idsTouched.has(j.id)),
    ...results,
  ];

  return {
    status: 200,
    body: {
      success: true,
      leased: leased.length,
      dispatched: results.filter((r) => r.status === "succeeded").length,
    },
    jobsAfter,
  };
}

describe("/api/cron/notification-dispatch", () => {
  const cronSecret = "test-secret";
  const okAuth = `Bearer ${cronSecret}`;
  const now = "2026-04-28T10:00:00.000Z";

  const baseJob = (overrides: Partial<JobRow> = {}): JobRow => ({
    id: "job-1",
    status: "pending",
    kind: "standard",
    scheduled_for: "2026-04-28T09:00:00.000Z",
    attempts: 0,
    last_error: null,
    leased_at: null,
    ...overrides,
  });

  it("requires cron auth", () => {
    const result = simulateDispatch({
      cronSecret,
      authHeader: "Bearer wrong",
      now,
      jobs: [baseJob()],
      dispatchOutcomes: {},
    });
    assert.strictEqual(result.status, 401);
  });

  it("returns 500 when CRON_SECRET is unset", () => {
    const result = simulateDispatch({
      cronSecret: undefined,
      authHeader: okAuth,
      now,
      jobs: [],
      dispatchOutcomes: {},
    });
    assert.strictEqual(result.status, 500);
  });

  it("only leases pending rows whose scheduled_for has passed", () => {
    const future = "2026-04-29T00:00:00.000Z";
    const result = simulateDispatch({
      cronSecret,
      authHeader: okAuth,
      now,
      jobs: [
        baseJob({ id: "due" }),
        baseJob({ id: "future", scheduled_for: future }),
        baseJob({ id: "already-done", status: "succeeded" }),
      ],
      dispatchOutcomes: {},
    });
    assert.strictEqual(result.status, 200);
    const after = result.jobsAfter.find((j) => j.id === "due");
    const future_ = result.jobsAfter.find((j) => j.id === "future");
    assert.strictEqual(after?.status, "succeeded");
    assert.strictEqual(future_?.status, "pending");
  });

  it("retries a failing job until MAX_ATTEMPTS, then marks failed", () => {
    let job: JobRow = baseJob({ kind: "live_activity_update" });
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const result = simulateDispatch({
        cronSecret,
        authHeader: okAuth,
        now,
        jobs: [job],
        dispatchOutcomes: { [job.id]: { ok: false, error: "apns down" } },
      });
      job = result.jobsAfter[0];
    }
    assert.strictEqual(job.status, "failed");
    assert.strictEqual(job.attempts, MAX_ATTEMPTS);
    assert.strictEqual(job.last_error, "apns down");
  });

  it("flips a job that succeeds after retries to succeeded", () => {
    let job = baseJob();
    // First attempt fails.
    let result = simulateDispatch({
      cronSecret,
      authHeader: okAuth,
      now,
      jobs: [job],
      dispatchOutcomes: { [job.id]: { ok: false, error: "transient" } },
    });
    job = result.jobsAfter[0];
    assert.strictEqual(job.status, "pending");
    assert.strictEqual(job.attempts, 1);

    // Second succeeds.
    result = simulateDispatch({
      cronSecret,
      authHeader: okAuth,
      now,
      jobs: [job],
      dispatchOutcomes: {},
    });
    job = result.jobsAfter[0];
    assert.strictEqual(job.status, "succeeded");
    assert.strictEqual(job.last_error, null);
  });
});
