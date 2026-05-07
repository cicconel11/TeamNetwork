import { describe, it, before } from "node:test";
import assert from "node:assert";
import {
  skipWithoutSupabase,
  supabaseEnvMissing,
  createIntegrationContext,
} from "../utils/supabaseIntegration.ts";

// These tests use limit(0) to validate column shapes without fetching data.
// A PostgREST error on a bad column name will be caught immediately, giving
// a fast schema-drift signal even before any rows exist.

describe("critical query column shapes", () => {
  let ctx: ReturnType<typeof createIntegrationContext>;

  before(async () => {
    // SuiteContext lacks .skip() — use supabaseEnvMissing() and return early.
    if (supabaseEnvMissing()) return;
    ctx = createIntegrationContext();
  });

  it("alumni select — columns consumed by production code", async (t) => {
    if (skipWithoutSupabase(t)) return;
    const { error } = await ctx.supabase
      .from("alumni")
      .select(
        "id, first_name, last_name, email, linkedin_url, graduation_year, organization_id, user_id, deleted_at, created_at, updated_at",
      )
      .limit(0);
    assert.ifError(error);
  });

  it("user_organization_roles select — role + status columns", async (t) => {
    if (skipWithoutSupabase(t)) return;
    const { error } = await ctx.supabase
      .from("user_organization_roles")
      .select("user_id, organization_id, role, status")
      .limit(0);
    assert.ifError(error);
  });

  it("members select — columns used by AI list_members tool", async (t) => {
    if (skipWithoutSupabase(t)) return;
    const { error } = await ctx.supabase
      .from("members")
      .select("id, user_id, status, role, created_at, first_name, last_name, email")
      .order("created_at", { ascending: false })
      .limit(0);
    assert.ifError(error);
  });

  it("events select — columns used by philanthropy export", async (t) => {
    if (skipWithoutSupabase(t)) return;
    const { error } = await ctx.supabase
      .from("events")
      .select(
        "id, title, start_date, end_date, location, description, organization_id, event_type, is_philanthropy, created_at, updated_at",
      )
      .limit(0);
    assert.ifError(error);
  });

  it("organization_donations select with events join", async (t) => {
    if (skipWithoutSupabase(t)) return;
    const { error } = await ctx.supabase
      .from("organization_donations")
      .select(
        "id, donor_name, donor_email, amount_cents, currency, purpose, status, created_at, event_id, events(title)",
      )
      .limit(0);
    assert.ifError(error);
  });
});
