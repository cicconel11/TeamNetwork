import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeHandoffHealth,
  evaluateHandoffHealth,
  DEFAULT_FLOOR,
  DEFAULT_MIN_CONSUME_RATIO,
} from "@/lib/mobile-auth-health/queries";

// ── Mock service client ──────────────────────────────────────────────────────
//
// The count queries chain `.from(...).select(..., {head:true}).gte(...)` for the
// created count and `.from(...).select(...).not(...).gte(...)` for consumed.
// Each terminal call resolves to `{ count, error }`. We return a thenable
// builder that records which branch (created vs consumed) it is and yields the
// right count, so no real Supabase or network is involved.

interface MockCounts {
  created: number;
  consumed: number;
  createdError?: string;
  consumedError?: string;
}

function makeMockClient(counts: MockCounts): SupabaseClient {
  function buildQuery() {
    const state = { isConsumed: false };
    const result = () =>
      state.isConsumed
        ? {
            count: counts.consumed,
            error: counts.consumedError ? { message: counts.consumedError } : null,
          }
        : {
            count: counts.created,
            error: counts.createdError ? { message: counts.createdError } : null,
          };

    const builder: Record<string, unknown> = {
      select: () => builder,
      gte: () => builder,
      // `.not("consumed_at", ...)` only appears on the consumed query.
      not: () => {
        state.isConsumed = true;
        return builder;
      },
      then: (resolve: (v: unknown) => unknown) => resolve(result()),
    };
    return builder;
  }

  return { from: () => buildQuery() } as unknown as SupabaseClient;
}

// ── evaluateHandoffHealth (pure threshold logic) ─────────────────────────────

describe("evaluateHandoffHealth", () => {
  it("does not alert on a healthy ratio (20 created / 18 consumed)", () => {
    const verdict = evaluateHandoffHealth({ created: 20, consumed: 18 });
    assert.equal(verdict.alert, false);
    assert.ok(verdict.ratio >= DEFAULT_MIN_CONSUME_RATIO);
  });

  it("alerts on the 37 created / 3 consumed incident signature", () => {
    const verdict = evaluateHandoffHealth({ created: 37, consumed: 3 });
    assert.equal(verdict.alert, true);
    assert.ok(verdict.ratio < DEFAULT_MIN_CONSUME_RATIO);
    assert.match(verdict.reason, /low consume ratio/);
  });

  it("stays silent below the floor even at a 0% ratio (4 created / 0 consumed)", () => {
    assert.ok(4 < DEFAULT_FLOOR, "test assumes 4 is below the default floor");
    const verdict = evaluateHandoffHealth({ created: 4, consumed: 0 });
    assert.equal(verdict.alert, false);
    assert.match(verdict.reason, /below floor/);
  });

  it("does not alert at exactly the ratio threshold (10 created / 5 consumed)", () => {
    // ratio === minConsumeRatio is healthy; only strictly-below fires.
    const verdict = evaluateHandoffHealth({ created: 10, consumed: 5 });
    assert.equal(verdict.alert, false);
  });

  it("does not divide by zero when nothing was created", () => {
    const verdict = evaluateHandoffHealth({ created: 0, consumed: 0 });
    assert.equal(verdict.alert, false);
    assert.equal(verdict.ratio, 0);
  });
});

// ── computeHandoffHealth (count query over the window) ───────────────────────

describe("computeHandoffHealth", () => {
  it("returns created/consumed counts and a window start from the injected clock", async () => {
    const now = Date.parse("2026-06-30T12:00:00.000Z");
    const windowMs = 24 * 60 * 60 * 1000;
    const client = makeMockClient({ created: 37, consumed: 3 });

    const { data, error } = await computeHandoffHealth(client, { now, windowMs });

    assert.equal(error, null);
    assert.ok(data);
    assert.equal(data.created, 37);
    assert.equal(data.consumed, 3);
    assert.equal(data.windowStart, new Date(now - windowMs).toISOString());
  });

  it("surfaces the created-count query error", async () => {
    const client = makeMockClient({ created: 0, consumed: 0, createdError: "boom" });
    const { data, error } = await computeHandoffHealth(client);
    assert.equal(data, null);
    assert.ok(error instanceof Error);
    assert.equal(error.message, "boom");
  });

  it("surfaces the consumed-count query error", async () => {
    const client = makeMockClient({ created: 10, consumed: 0, consumedError: "kaboom" });
    const { data, error } = await computeHandoffHealth(client);
    assert.equal(data, null);
    assert.ok(error instanceof Error);
    assert.equal(error.message, "kaboom");
  });
});

// ── Cron route: security + no-leak invariants (source assertions) ────────────

const routeSource = readFileSync(
  join(process.cwd(), "src/app/api/cron/mobile-auth-handoff-health/route.ts"),
  "utf8",
);

describe("mobile-auth-handoff-health cron route", () => {
  it("guards with validateCronAuth on the first line of GET (rejects bad/missing Bearer)", () => {
    // validateCronAuth returns a 401 (bad Bearer) or 500 (unset secret) response;
    // the route must return it before any DB or email work.
    assert.match(routeSource, /const authError = validateCronAuth\(request\)/);
    assert.match(routeSource, /if \(authError\) return authError/);
    const authIdx = routeSource.indexOf("validateCronAuth(request)");
    const serviceIdx = routeSource.indexOf("createServiceClient()");
    assert.ok(authIdx >= 0 && serviceIdx >= 0);
    assert.ok(authIdx < serviceIdx, "auth guard must run before service client work");
  });

  it("uses the service-role client (RLS-no-policies table)", () => {
    assert.match(routeSource, /createServiceClient\(\)/);
  });

  it("resolves recipients from ALERT_EMAIL_TO then ADMIN_EMAIL", () => {
    assert.match(routeSource, /process\.env\.ALERT_EMAIL_TO/);
    assert.match(routeSource, /process\.env\.ADMIN_EMAIL/);
  });

  it("is dynamic + nodejs runtime", () => {
    assert.match(routeSource, /export const dynamic = "force-dynamic"/);
    assert.match(routeSource, /export const runtime = "nodejs"/);
  });

  it("does not read tokens, code hashes, or PII (aggregate counts only)", () => {
    // No sensitive column names should appear anywhere in the route.
    for (const forbidden of [
      "code_hash",
      "encrypted_access_token",
      "encrypted_refresh_token",
      "user_id",
    ]) {
      assert.ok(
        !routeSource.includes(forbidden),
        `route must not reference ${forbidden}`,
      );
    }
  });
});
