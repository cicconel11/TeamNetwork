import { describe, it, before } from "node:test";
import assert from "node:assert";
import {
  skipWithoutSupabase,
  supabaseEnvMissing,
  createIntegrationContext,
} from "../utils/supabaseIntegration.ts";

// src/lib/pagination/cursor.ts does not exist in this codebase yet, so this
// test validates the raw Supabase timestamptz format directly. When the cursor
// module is added, extend this suite to test encode/decode round-trips against
// real DB timestamps.

describe("cursor pagination against real Supabase timestamptz", () => {
  let ctx: ReturnType<typeof createIntegrationContext>;
  let realTimestamp: string;

  before(async () => {
    // SuiteContext lacks .skip() — use supabaseEnvMissing() and return early.
    if (supabaseEnvMissing()) return;
    ctx = createIntegrationContext();
    const { data } = await ctx.supabase
      .from("organizations")
      .select("id, created_at")
      .limit(1)
      .single();
    assert.ok(data?.created_at, "Need at least one org with created_at");
    realTimestamp = data.created_at;
  });

  it("real Supabase timestamptz is a valid ISO 8601 date string", async (t) => {
    if (skipWithoutSupabase(t)) return;
    assert.ok(realTimestamp, "Should have a real timestamp from organizations table");
    assert.ok(
      !isNaN(Date.parse(realTimestamp)),
      `Timestamp should be a valid ISO date, got: ${realTimestamp}`,
    );
  });

  it("real Supabase timestamptz round-trips through Date constructor", async (t) => {
    if (skipWithoutSupabase(t)) return;
    const parsed = new Date(realTimestamp);
    assert.strictEqual(
      parsed.toISOString().slice(0, 10),
      realTimestamp.slice(0, 10),
      "Year-month-day should be preserved through Date round-trip",
    );
  });
});
