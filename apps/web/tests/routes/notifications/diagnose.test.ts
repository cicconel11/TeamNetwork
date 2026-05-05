import test from "node:test";
import assert from "node:assert";
import { diagnosePush } from "../../../src/lib/notifications/diagnose.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

const orgId = "00000000-0000-4000-8000-000000000d01";
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tok = (n: number) =>
  `ExponentPushToken[diag${String(n).padStart(20, "0")}]`;

test("diagnosePush categorizes each recipient by drop reason", async () => {
  const supabase = createSupabaseStub();
  supabase.seed("organizations", [{ id: orgId, slug: "team" }]);
  supabase.seed("user_organization_roles", [
    { organization_id: orgId, user_id: u(1), role: "active_member", status: "active" },
    { organization_id: orgId, user_id: u(2), role: "active_member", status: "active" },
    { organization_id: orgId, user_id: u(3), role: "active_member", status: "active" },
    { organization_id: orgId, user_id: u(4), role: "active_member", status: "active" },
    { organization_id: orgId, user_id: u(5), role: "active_member", status: "active" },
  ]);
  // u1: delivered (token + default prefs)
  supabase.seed("user_push_tokens", [
    { user_id: u(1), expo_push_token: tok(1) },
    { user_id: u(2), expo_push_token: tok(2) },
    { user_id: u(3), expo_push_token: tok(3) },
    { user_id: u(5), expo_push_token: "not-a-token" },
  ]);
  supabase.seed("notification_preferences", [
    { organization_id: orgId, user_id: u(2), push_enabled: false },
    {
      organization_id: orgId,
      user_id: u(3),
      push_enabled: true,
      announcement_push_enabled: false,
    },
  ]);

  const result = await diagnosePush({
    supabase: supabase as never,
    organizationId: orgId,
    audience: "members",
    category: "announcement",
  });

  assert.strictEqual(result.totalInAudience, 5);
  assert.strictEqual(result.delivered, 1);
  assert.strictEqual(result.byReason.global_push_disabled, 1);
  assert.strictEqual(result.byReason.category_disabled, 1);
  assert.strictEqual(result.byReason.no_token, 1);
  assert.strictEqual(result.byReason.invalid_token, 1);

  const byUser = new Map(result.recipients.map((r) => [r.userId, r]));
  assert.strictEqual(byUser.get(u(1))?.reason, "delivered");
  assert.strictEqual(byUser.get(u(2))?.reason, "global_push_disabled");
  assert.strictEqual(byUser.get(u(3))?.reason, "category_disabled");
  assert.strictEqual(byUser.get(u(4))?.reason, "no_token");
  assert.strictEqual(byUser.get(u(5))?.reason, "invalid_token");
});
