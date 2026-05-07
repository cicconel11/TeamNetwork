import { describe, it, before } from "node:test";
import assert from "node:assert";
import {
  skipWithoutSupabase,
  supabaseEnvMissing,
  createIntegrationContext,
} from "../utils/supabaseIntegration.ts";
import { encodeCursor, decodeCursor } from "@/lib/pagination/cursor";

describe("cursor pagination against real Supabase timestamptz", () => {
  let ctx: ReturnType<typeof createIntegrationContext>;
  let realTimestamp: string;
  const validId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

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

  it("real Supabase timestamptz round-trips through encodeCursor/decodeCursor", async (t) => {
    if (skipWithoutSupabase(t)) return;
    const cursor = encodeCursor(realTimestamp, validId);
    const decoded = decodeCursor(cursor);

    assert.deepStrictEqual(decoded, {
      createdAt: realTimestamp,
      id: validId,
    });
  });

  it("real Supabase timestamptz is accepted by the production cursor validator", async (t) => {
    if (skipWithoutSupabase(t)) return;
    const payload = Buffer.from(
      JSON.stringify({ t: realTimestamp, i: validId })
    ).toString("base64url");
    const decoded = decodeCursor(payload);

    assert.ok(decoded, `decodeCursor should accept real Supabase timestamp: ${realTimestamp}`);
    assert.strictEqual(decoded?.createdAt, realTimestamp);
    assert.strictEqual(decoded?.id, validId);
  });
});
