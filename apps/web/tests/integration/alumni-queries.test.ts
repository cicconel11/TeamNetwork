import { describe, it, after, before } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import {
  skipWithoutSupabase,
  supabaseEnvMissing,
  createIntegrationContext,
} from "../utils/supabaseIntegration.ts";

describe("alumni queries against real Supabase", () => {
  let ctx: ReturnType<typeof createIntegrationContext>;
  let testOrgId: string;

  before(async () => {
    // SuiteContext lacks .skip() — use supabaseEnvMissing() and return early.
    if (supabaseEnvMissing()) return;
    ctx = createIntegrationContext();
    const { data } = await ctx.supabase
      .from("organizations")
      .select("id")
      .limit(1)
      .single();
    assert.ok(data, "Need at least one org in dev DB");
    testOrgId = data.id;
  });

  after(async () => {
    if (ctx) await ctx.cleanup();
  });

  it("insert + soft-delete + filter excludes deleted", async (t) => {
    if (skipWithoutSupabase(t)) return;
    const id = randomUUID();
    const { error: insertErr } = await ctx.supabase.from("alumni").insert({
      id,
      organization_id: testOrgId,
      first_name: "Test",
      last_name: `Integration-${id.slice(0, 8)}`,
    });
    assert.ifError(insertErr);
    ctx.track("alumni", id);

    const { error: delErr } = await ctx.supabase
      .from("alumni")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    assert.ifError(delErr);

    const { data: filtered } = await ctx.supabase
      .from("alumni")
      .select("id")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    assert.strictEqual(filtered, null, "Soft-deleted alumni should be excluded");
  });

  it("querying non-existent column returns error, not silent null", async (t) => {
    if (skipWithoutSupabase(t)) return;
    const { data, error } = await ctx.supabase
      .from("alumni")
      .select("id, nonexistent_column_xyz")
      .limit(1);
    assert.ok(error, "Non-existent column should return an error");
    assert.strictEqual(data, null);
  });
});
