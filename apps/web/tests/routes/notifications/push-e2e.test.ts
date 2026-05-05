import test from "node:test";
import assert from "node:assert";
import { sendPush } from "../../../src/lib/notifications/push.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import { createExpoStub } from "../../utils/expoStub.ts";

const orgId = "00000000-0000-4000-8000-0000000000aa";
const announcementId = "00000000-0000-4000-8000-0000000000bb";

function userId(n: number) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function expoToken(n: number) {
  return `ExponentPushToken[user${String(n).padStart(20, "0")}]`;
}

interface SeedSpec {
  user: number;
  role: "admin" | "active_member" | "alumni" | "viewer" | "member";
  status?: "active" | "pending" | "revoked";
  pref?: { push_enabled?: boolean; announcement_push_enabled?: boolean };
  tokens?: number; // how many push tokens to register (multi-device)
  tokenOverride?: string; // explicit token (e.g. invalid)
}

function seedOrg(supabase: ReturnType<typeof createSupabaseStub>, spec: SeedSpec[]) {
  supabase.seed("organizations", [{ id: orgId, slug: "team" }]);
  for (const s of spec) {
    supabase.seed("user_organization_roles", [
      {
        organization_id: orgId,
        user_id: userId(s.user),
        role: s.role,
        status: s.status ?? "active",
      },
    ]);
    if (s.pref) {
      supabase.seed("notification_preferences", [
        {
          organization_id: orgId,
          user_id: userId(s.user),
          push_enabled: s.pref.push_enabled ?? true,
          announcement_push_enabled: s.pref.announcement_push_enabled ?? true,
        },
      ]);
    }
    const tokenCount = s.tokens ?? 1;
    if (s.tokenOverride !== undefined) {
      supabase.seed("user_push_tokens", [
        { user_id: userId(s.user), expo_push_token: s.tokenOverride },
      ]);
    } else if (tokenCount > 0) {
      const rows = Array.from({ length: tokenCount }, (_, i) => ({
        user_id: userId(s.user),
        expo_push_token: expoToken(s.user * 100 + i),
      }));
      supabase.seed("user_push_tokens", rows);
    }
  }
}

const baseInput = {
  organizationId: orgId,
  title: "Big news",
  body: "Read this",
  category: "announcement" as const,
  pushType: "announcement" as const,
  pushResourceId: announcementId,
  orgSlug: "team",
};

test("happy path: members audience reaches admins + active_members, skips alumni", async () => {
  const supabase = createSupabaseStub();
  const expo = createExpoStub();
  seedOrg(supabase, [
    { user: 1, role: "admin" },
    { user: 2, role: "active_member" },
    { user: 3, role: "active_member" },
    { user: 4, role: "active_member" },
    { user: 5, role: "alumni" },
    { user: 6, role: "alumni" },
  ]);

  const result = await sendPush({
    ...baseInput,
    supabase: supabase as never,
    audience: "members",
    expoClient: expo,
  });

  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.sent, 4, "admins + active_members get push");
  assert.strictEqual(result.queued, 0);
  assert.strictEqual(expo.messages.length, 4);
  for (const msg of expo.messages) {
    const data = msg.data as Record<string, unknown>;
    assert.strictEqual(data.type, "announcement");
    assert.strictEqual(data.id, announcementId);
    assert.strictEqual(data.orgSlug, "team");
    assert.strictEqual(msg.title, "Big news");
  }
});

test("alumni audience excludes active members", async () => {
  const supabase = createSupabaseStub();
  const expo = createExpoStub();
  seedOrg(supabase, [
    { user: 1, role: "admin" },
    { user: 2, role: "active_member" },
    { user: 3, role: "alumni" },
    { user: 4, role: "alumni" },
  ]);

  const result = await sendPush({
    ...baseInput,
    supabase: supabase as never,
    audience: "alumni",
    expoClient: expo,
  });

  assert.strictEqual(result.sent, 2);
  assert.strictEqual(expo.messages.length, 2);
});

test("audience=both reaches every active role", async () => {
  const supabase = createSupabaseStub();
  const expo = createExpoStub();
  seedOrg(supabase, [
    { user: 1, role: "admin" },
    { user: 2, role: "active_member" },
    { user: 3, role: "alumni" },
    { user: 4, role: "viewer" },
  ]);

  const result = await sendPush({
    ...baseInput,
    supabase: supabase as never,
    audience: "both",
    expoClient: expo,
  });

  assert.strictEqual(result.sent, 4);
});

test("targetUserIds intersects with audience", async () => {
  const supabase = createSupabaseStub();
  const expo = createExpoStub();
  seedOrg(supabase, [
    { user: 1, role: "active_member" },
    { user: 2, role: "active_member" },
    { user: 3, role: "active_member" },
  ]);

  const result = await sendPush({
    ...baseInput,
    supabase: supabase as never,
    audience: "members",
    targetUserIds: [userId(1), userId(3)],
    expoClient: expo,
  });

  assert.strictEqual(result.sent, 2);
  const recipients = expo.messages.map((m) => m.to as string).sort();
  assert.deepStrictEqual(recipients, [expoToken(100), expoToken(300)].sort());
});

test("global push_enabled=false drops the user", async () => {
  const supabase = createSupabaseStub();
  const expo = createExpoStub();
  seedOrg(supabase, [
    { user: 1, role: "active_member" },
    { user: 2, role: "active_member", pref: { push_enabled: false } },
    { user: 3, role: "active_member" },
  ]);

  const result = await sendPush({
    ...baseInput,
    supabase: supabase as never,
    audience: "members",
    expoClient: expo,
  });

  assert.strictEqual(result.sent, 2);
  assert.strictEqual(result.skipped, 1);
  const recipients = expo.messages.map((m) => m.to as string);
  assert.ok(!recipients.includes(expoToken(200)));
});

test("category-specific opt-out drops the user even with global push_enabled=true", async () => {
  const supabase = createSupabaseStub();
  const expo = createExpoStub();
  seedOrg(supabase, [
    { user: 1, role: "active_member" },
    {
      user: 2,
      role: "active_member",
      pref: { push_enabled: true, announcement_push_enabled: false },
    },
  ]);

  const result = await sendPush({
    ...baseInput,
    supabase: supabase as never,
    audience: "members",
    expoClient: expo,
  });

  assert.strictEqual(result.sent, 1);
  assert.strictEqual(result.skipped, 1);
});

test("missing notification_preferences row falls back to category default (announcement=true)", async () => {
  const supabase = createSupabaseStub();
  const expo = createExpoStub();
  seedOrg(supabase, [{ user: 1, role: "active_member" /* no pref row */ }]);

  const result = await sendPush({
    ...baseInput,
    supabase: supabase as never,
    audience: "members",
    expoClient: expo,
  });

  assert.strictEqual(result.sent, 1, "default for announcement is true");
});

test("multiple devices per user each receive a push", async () => {
  const supabase = createSupabaseStub();
  const expo = createExpoStub();
  seedOrg(supabase, [
    { user: 1, role: "active_member", tokens: 2 },
    { user: 2, role: "active_member", tokens: 1 },
  ]);

  const result = await sendPush({
    ...baseInput,
    supabase: supabase as never,
    audience: "members",
    expoClient: expo,
  });

  assert.strictEqual(result.sent, 3, "one push per device");
  assert.strictEqual(expo.messages.length, 3);
});

test("DeviceNotRegistered ticket triggers token cleanup", async () => {
  const supabase = createSupabaseStub();
  const expo = createExpoStub();
  seedOrg(supabase, [
    { user: 1, role: "active_member" },
    { user: 2, role: "active_member" },
  ]);

  const deadToken = expoToken(200);
  expo.setTicket(deadToken, {
    status: "error",
    message: "device not registered",
    details: { error: "DeviceNotRegistered" },
  });

  const result = await sendPush({
    ...baseInput,
    supabase: supabase as never,
    audience: "members",
    expoClient: expo,
  });

  assert.strictEqual(result.sent, 1);
  assert.strictEqual(result.errors.length, 0, "DeviceNotRegistered is handled, not surfaced");

  const remainingTokens = supabase.getRows("user_push_tokens").map((r) => r.expo_push_token);
  assert.ok(!remainingTokens.includes(deadToken), "stale token deleted");
  assert.ok(remainingTokens.includes(expoToken(100)), "valid token retained");
});

test("invalid expo token in DB is filtered out before send", async () => {
  const supabase = createSupabaseStub();
  const expo = createExpoStub();
  seedOrg(supabase, [
    { user: 1, role: "active_member", tokenOverride: "not-a-valid-token" },
    { user: 2, role: "active_member" },
  ]);

  const result = await sendPush({
    ...baseInput,
    supabase: supabase as never,
    audience: "members",
    expoClient: expo,
  });

  assert.strictEqual(result.sent, 1, "invalid token excluded, valid still sent");
  assert.strictEqual(expo.messages.length, 1);
});

test("orgSlug missing logs warning but still sends with type+id", async () => {
  const supabase = createSupabaseStub();
  const expo = createExpoStub();
  seedOrg(supabase, [{ user: 1, role: "active_member" }]);

  const result = await sendPush({
    ...baseInput,
    orgSlug: undefined,
    supabase: supabase as never,
    audience: "members",
    expoClient: expo,
  });

  assert.strictEqual(result.sent, 1);
  const data = expo.messages[0].data as Record<string, unknown>;
  assert.strictEqual(data.orgSlug, undefined);
  assert.strictEqual(data.type, "announcement");
});

test("revoked memberships are excluded", async () => {
  const supabase = createSupabaseStub();
  const expo = createExpoStub();
  seedOrg(supabase, [
    { user: 1, role: "active_member", status: "active" },
    { user: 2, role: "active_member", status: "revoked" },
    { user: 3, role: "active_member", status: "pending" },
  ]);

  const result = await sendPush({
    ...baseInput,
    supabase: supabase as never,
    audience: "members",
    expoClient: expo,
  });

  assert.strictEqual(result.sent, 1, "only status=active receives push");
});
