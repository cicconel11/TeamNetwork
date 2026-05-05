import test from "node:test";
import assert from "node:assert";
import { sendPush, INLINE_PUSH_TOKEN_CAP } from "../../../src/lib/notifications/push.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

const orgId = "00000000-0000-4000-8000-000000000001";

function expoToken(index: number) {
  return `ExponentPushToken[aaaaaaaaaaaaaaaa${String(index).padStart(6, "0")}]`;
}

test("sendPush queues announcement broadcasts above the inline token cap", async () => {
  const supabase = createSupabaseStub();
  const recipientCount = INLINE_PUSH_TOKEN_CAP + 1;

  supabase.seed("organizations", [{ id: orgId, slug: "team" }]);
  supabase.seed(
    "user_organization_roles",
    Array.from({ length: recipientCount }, (_, index) => ({
      organization_id: orgId,
      user_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      role: "active_member",
      status: "active",
    })),
  );
  supabase.seed(
    "user_push_tokens",
    Array.from({ length: recipientCount }, (_, index) => ({
      user_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      expo_push_token: expoToken(index),
    })),
  );

  const result = await sendPush({
    supabase: supabase as never,
    organizationId: orgId,
    audience: "members",
    title: "Announcement",
    body: "Read this",
    category: "announcement",
    pushType: "announcement",
    pushResourceId: "00000000-0000-4000-8000-000000000099",
    orgSlug: "team",
  });

  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.sent, 0);
  assert.strictEqual(result.queued, recipientCount);
  assert.strictEqual(result.skipped, 0);

  const jobs = supabase.getRows("notification_jobs");
  assert.strictEqual(jobs.length, 1);
  assert.strictEqual(jobs[0].organization_id, orgId);
  assert.strictEqual(jobs[0].kind, "standard");
  assert.strictEqual(jobs[0].category, "announcement");
  assert.strictEqual(jobs[0].push_type, "announcement");
  assert.deepStrictEqual(jobs[0].data, { orgSlug: "team" });
});

test("sendPush surfaces token resolution failures instead of looking like zero recipients", async () => {
  const supabase = createSupabaseStub();
  supabase.seed("user_organization_roles", [
    {
      organization_id: orgId,
      user_id: "00000000-0000-4000-8000-000000000001",
      role: "active_member",
      status: "active",
    },
  ]);
  supabase.simulateError("user_push_tokens", { message: "relation does not exist" });

  const result = await sendPush({
    supabase: supabase as never,
    organizationId: orgId,
    audience: "members",
    title: "Announcement",
    body: "Read this",
    category: "announcement",
    pushType: "announcement",
    pushResourceId: "00000000-0000-4000-8000-000000000099",
    orgSlug: "team",
  });

  assert.strictEqual(result.sent, 0);
  assert.strictEqual(result.queued, 0);
  assert.match(result.errors.join("\n"), /push token query failed: relation does not exist/);
});
