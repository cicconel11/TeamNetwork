/**
 * Analytics Profile Generator Tests
 *
 * Tests for delta detection and hash computation.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Recreate types locally
// ---------------------------------------------------------------------------

interface UsageSummary {
  id: string;
  user_id: string;
  organization_id: string;
  feature: string;
  visit_count: number;
  total_duration_ms: number;
  last_visited_at: string | null;
  peak_hour: number | null;
  device_preference: string | null;
  period_start: string;
  period_end: string;
}

// ---------------------------------------------------------------------------
// Recreate hashSummaries from profile-generator.ts
// ---------------------------------------------------------------------------

function hashSummaries(summaries: UsageSummary[]): string {
  const normalized = summaries
    .map((s) => `${s.feature}:${s.visit_count}:${s.total_duration_ms}:${s.peak_hour}:${s.device_preference}`)
    .sort()
    .join("|");
  return createHash("sha256").update(normalized).digest("hex");
}

// ===========================================================================
// Tests
// ===========================================================================

const baseSummary: UsageSummary = {
  id: "s1",
  user_id: "u1",
  organization_id: "o1",
  feature: "dashboard",
  visit_count: 10,
  total_duration_ms: 50000,
  last_visited_at: "2026-02-01T12:00:00Z",
  peak_hour: 14,
  device_preference: "desktop",
  period_start: "2026-01-27",
  period_end: "2026-02-03",
};

describe("Analytics Profile Generator - hashSummaries", () => {
  it("returns a valid SHA-256 hex string", () => {
    const hash = hashSummaries([baseSummary]);
    assert.match(hash, /^[a-f0-9]{64}$/);
  });

  it("returns the same hash for identical summaries", () => {
    const hash1 = hashSummaries([baseSummary]);
    const hash2 = hashSummaries([{ ...baseSummary }]);
    assert.strictEqual(hash1, hash2);
  });

  it("returns different hash when visit_count changes", () => {
    const modified = { ...baseSummary, visit_count: 20 };
    const hash1 = hashSummaries([baseSummary]);
    const hash2 = hashSummaries([modified]);
    assert.notStrictEqual(hash1, hash2);
  });

  it("returns different hash when total_duration_ms changes", () => {
    const modified = { ...baseSummary, total_duration_ms: 99999 };
    const hash1 = hashSummaries([baseSummary]);
    const hash2 = hashSummaries([modified]);
    assert.notStrictEqual(hash1, hash2);
  });

  it("returns different hash when peak_hour changes", () => {
    const modified = { ...baseSummary, peak_hour: 8 };
    const hash1 = hashSummaries([baseSummary]);
    const hash2 = hashSummaries([modified]);
    assert.notStrictEqual(hash1, hash2);
  });

  it("returns different hash when device_preference changes", () => {
    const modified = { ...baseSummary, device_preference: "mobile" };
    const hash1 = hashSummaries([baseSummary]);
    const hash2 = hashSummaries([modified]);
    assert.notStrictEqual(hash1, hash2);
  });

  it("returns different hash when feature changes", () => {
    const modified = { ...baseSummary, feature: "members" };
    const hash1 = hashSummaries([baseSummary]);
    const hash2 = hashSummaries([modified]);
    assert.notStrictEqual(hash1, hash2);
  });

  it("is order-independent (sorted before hashing)", () => {
    const s1 = { ...baseSummary, feature: "dashboard", visit_count: 10 };
    const s2 = { ...baseSummary, feature: "members", visit_count: 5 };

    const hash1 = hashSummaries([s1, s2]);
    const hash2 = hashSummaries([s2, s1]);
    assert.strictEqual(hash1, hash2);
  });

  it("ignores fields not used in hash (user_id, org_id, dates)", () => {
    const modified = {
      ...baseSummary,
      id: "different-id",
      user_id: "different-user",
      organization_id: "different-org",
      last_visited_at: "2099-01-01T00:00:00Z",
      period_start: "2099-01-01",
      period_end: "2099-01-08",
    };
    const hash1 = hashSummaries([baseSummary]);
    const hash2 = hashSummaries([modified]);
    assert.strictEqual(hash1, hash2);
  });

  it("handles null peak_hour and device_preference", () => {
    const s1 = { ...baseSummary, peak_hour: null, device_preference: null };
    const hash = hashSummaries([s1]);
    assert.match(hash, /^[a-f0-9]{64}$/);
  });

  it("distinguishes null from actual values", () => {
    const withNull = { ...baseSummary, peak_hour: null };
    const withValue = { ...baseSummary, peak_hour: 0 };
    const hash1 = hashSummaries([withNull]);
    const hash2 = hashSummaries([withValue]);
    assert.notStrictEqual(hash1, hash2);
  });

  it("handles empty array", () => {
    const hash = hashSummaries([]);
    assert.match(hash, /^[a-f0-9]{64}$/);
  });

  it("returns consistent hash for empty array", () => {
    const hash1 = hashSummaries([]);
    const hash2 = hashSummaries([]);
    assert.strictEqual(hash1, hash2);
  });
});
