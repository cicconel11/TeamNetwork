import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "./utils/supabaseStub";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildNotificationTargets } from "@/lib/notifications";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function makeStub() {
  const stub = createSupabaseStub();

  // Seed memberships
  stub.seed("user_organization_roles", [
    { user_id: USER_A, organization_id: ORG_ID, role: "active_member", status: "active" },
    { user_id: USER_B, organization_id: ORG_ID, role: "active_member", status: "active" },
    { user_id: USER_C, organization_id: ORG_ID, role: "alumni", status: "active" },
  ]);

  // Seed users
  stub.seed("users", [
    { id: USER_A, email: "a@example.com", name: "User A" },
    { id: USER_B, email: "b@example.com", name: "User B" },
    { id: USER_C, email: "c@example.com", name: "User C" },
  ]);

  return stub;
}

describe("buildNotificationTargets with category filtering", () => {
  let stub: ReturnType<typeof createSupabaseStub>;
  let supabase: SupabaseClient<Database>;

  beforeEach(() => {
    stub = makeStub();
    supabase = stub as never;
  });

  it("returns all email-enabled users when no category is specified", async () => {
    // User A has email enabled, User B has email enabled via preferences
    stub.seed("notification_preferences", [
      {
        user_id: USER_A,
        organization_id: ORG_ID,
        email_enabled: true,
        email_address: "a@example.com",
        sms_enabled: false,
        phone_number: null,
        announcement_emails_enabled: true,
        discussion_emails_enabled: true,
        event_emails_enabled: false,
        workout_emails_enabled: true,
        competition_emails_enabled: true,
      },
    ]);

    const { targets, stats } = await buildNotificationTargets({
      supabase,
      organizationId: ORG_ID,
      audience: "both",
      channel: "email",
    });

    // All 3 users should be included (User A has prefs, B and C fall back to user email)
    assert.equal(stats.total, 3);
    const ids = targets.map((t) => t.id).sort();
    assert.deepEqual(ids, [USER_A, USER_B, USER_C].sort());
  });

  it("skips user who disabled event_emails_enabled when category is 'event'", async () => {
    stub.seed("notification_preferences", [
      {
        user_id: USER_A,
        organization_id: ORG_ID,
        email_enabled: true,
        email_address: "a@example.com",
        sms_enabled: false,
        phone_number: null,
        announcement_emails_enabled: true,
        discussion_emails_enabled: true,
        event_emails_enabled: false,
        workout_emails_enabled: true,
        competition_emails_enabled: true,
      },
      {
        user_id: USER_B,
        organization_id: ORG_ID,
        email_enabled: true,
        email_address: "b@example.com",
        sms_enabled: false,
        phone_number: null,
        announcement_emails_enabled: true,
        discussion_emails_enabled: true,
        event_emails_enabled: true,
        workout_emails_enabled: true,
        competition_emails_enabled: true,
      },
    ]);

    const { targets, stats } = await buildNotificationTargets({
      supabase,
      organizationId: ORG_ID,
      audience: "both",
      channel: "email",
      category: "event",
    });

    // User A should be skipped (event_emails_enabled = false)
    const ids = targets.map((t) => t.id);
    assert.ok(!ids.includes(USER_A), "User A should be skipped for event category");
    assert.ok(ids.includes(USER_B), "User B should be included");
    assert.ok(ids.includes(USER_C), "User C should be included (no pref row = defaults true)");
    assert.equal(stats.skippedMissingContact, 1);
  });

  it("includes user with no pref row when category is specified (defaults true)", async () => {
    // No preferences seeded for any user - they should all be included

    const { targets, stats } = await buildNotificationTargets({
      supabase,
      organizationId: ORG_ID,
      audience: "both",
      channel: "email",
      category: "event",
    });

    assert.equal(stats.total, 3);
    const ids = targets.map((t) => t.id).sort();
    assert.deepEqual(ids, [USER_A, USER_B, USER_C].sort());
  });

  it("skips user with email_enabled=false regardless of category", async () => {
    stub.seed("notification_preferences", [
      {
        user_id: USER_A,
        organization_id: ORG_ID,
        email_enabled: false,
        email_address: "a@example.com",
        sms_enabled: false,
        phone_number: null,
        announcement_emails_enabled: true,
        discussion_emails_enabled: true,
        event_emails_enabled: true,
        workout_emails_enabled: true,
        competition_emails_enabled: true,
      },
    ]);

    const { targets, stats } = await buildNotificationTargets({
      supabase,
      organizationId: ORG_ID,
      audience: "both",
      channel: "email",
      category: "announcement",
    });

    // User A should be skipped because email_enabled is false
    const ids = targets.map((t) => t.id);
    assert.ok(!ids.includes(USER_A), "User A should be skipped (master email disabled)");
    assert.equal(stats.total, 2);
  });

  it("filters by announcement category correctly", async () => {
    stub.seed("notification_preferences", [
      {
        user_id: USER_B,
        organization_id: ORG_ID,
        email_enabled: true,
        email_address: "b@example.com",
        sms_enabled: false,
        phone_number: null,
        announcement_emails_enabled: false,
        discussion_emails_enabled: true,
        event_emails_enabled: true,
        workout_emails_enabled: true,
        competition_emails_enabled: true,
      },
    ]);

    const { targets } = await buildNotificationTargets({
      supabase,
      organizationId: ORG_ID,
      audience: "both",
      channel: "email",
      category: "announcement",
    });

    const ids = targets.map((t) => t.id);
    assert.ok(!ids.includes(USER_B), "User B should be skipped for announcement category");
    assert.ok(ids.includes(USER_A), "User A should be included (no pref row)");
    assert.ok(ids.includes(USER_C), "User C should be included (no pref row)");
  });

  it("preserves SMS when user disables event email category with channel 'both'", async () => {
    stub.seed("notification_preferences", [
      {
        user_id: USER_A,
        organization_id: ORG_ID,
        email_enabled: true,
        email_address: "a@example.com",
        sms_enabled: true,
        phone_number: "+15551234567",
        announcement_emails_enabled: true,
        discussion_emails_enabled: true,
        event_emails_enabled: false,
        workout_emails_enabled: true,
        competition_emails_enabled: true,
      },
    ]);

    const { targets, stats } = await buildNotificationTargets({
      supabase,
      organizationId: ORG_ID,
      audience: "both",
      channel: "both",
      category: "event",
    });

    // User A should still appear with SMS-only (email removed by category opt-out)
    const userA = targets.find((t) => t.id === USER_A);
    assert.ok(userA, "User A should be in targets (SMS still enabled)");
    assert.deepEqual(userA.channels, ["sms"], "User A should only have sms channel");
    assert.equal(stats.skippedMissingContact, 0);
  });
});
