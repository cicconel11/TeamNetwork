import test from "node:test";
import assert from "node:assert";
import { sendPush, INLINE_PUSH_TOKEN_CAP } from "../../../src/lib/notifications/push.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import { createExpoStub } from "../../utils/expoStub.ts";

const orgId = "00000000-0000-4000-8000-000000000abc";

function userId(n: number) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function expoToken(n: number) {
  return `ExponentPushToken[drain${String(n).padStart(20, "0")}]`;
}

/**
 * The cron worker (`/api/cron/notification-dispatch`) calls sendPush with
 * forceInline=true to drain a queued notification_jobs row. Before commit
 * 0f38c9bb this re-queued forever — the worker would call sendPush, see
 * tokens > INLINE_PUSH_TOKEN_CAP, insert another notification_jobs row, and
 * loop. forceInline: true must short-circuit the enqueue path entirely.
 */
test("worker path (forceInline=true) drains all tokens inline, never re-queues", async () => {
  const supabase = createSupabaseStub();
  const expo = createExpoStub();
  const recipientCount = INLINE_PUSH_TOKEN_CAP + 50; // 250 tokens

  supabase.seed("organizations", [{ id: orgId, slug: "team" }]);
  supabase.seed(
    "user_organization_roles",
    Array.from({ length: recipientCount }, (_, i) => ({
      organization_id: orgId,
      user_id: userId(i + 1),
      role: "active_member",
      status: "active",
    })),
  );
  supabase.seed(
    "user_push_tokens",
    Array.from({ length: recipientCount }, (_, i) => ({
      user_id: userId(i + 1),
      expo_push_token: expoToken(i + 1),
    })),
  );

  const result = await sendPush({
    supabase: supabase as never,
    organizationId: orgId,
    audience: "members",
    title: "Big broadcast",
    body: "everyone",
    category: "announcement",
    pushType: "announcement",
    pushResourceId: "00000000-0000-4000-8000-0000000000ff",
    orgSlug: "team",
    forceInline: true,
    expoClient: expo,
  });

  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.sent, recipientCount, "all tokens drained inline");
  assert.strictEqual(result.queued, 0, "worker must NOT enqueue");
  assert.strictEqual(expo.messages.length, recipientCount);

  const jobs = supabase.getRows("notification_jobs");
  assert.strictEqual(jobs.length, 0, "no new job should be created by worker drain");
});

test("worker path chunks at Expo's 100/request limit", async () => {
  const supabase = createSupabaseStub();
  const expo = createExpoStub();
  const recipientCount = 250;

  supabase.seed("organizations", [{ id: orgId, slug: "team" }]);
  supabase.seed(
    "user_organization_roles",
    Array.from({ length: recipientCount }, (_, i) => ({
      organization_id: orgId,
      user_id: userId(i + 1),
      role: "active_member",
      status: "active",
    })),
  );
  supabase.seed(
    "user_push_tokens",
    Array.from({ length: recipientCount }, (_, i) => ({
      user_id: userId(i + 1),
      expo_push_token: expoToken(i + 1),
    })),
  );

  const originalSend = expo.sendPushNotificationsAsync.bind(expo);
  const chunkSizes: number[] = [];
  expo.sendPushNotificationsAsync = async (chunk) => {
    chunkSizes.push(chunk.length);
    return originalSend(chunk);
  };

  const result = await sendPush({
    supabase: supabase as never,
    organizationId: orgId,
    audience: "members",
    title: "Chunked",
    body: "send",
    category: "announcement",
    forceInline: true,
    expoClient: expo,
  });

  assert.strictEqual(result.sent, recipientCount);
  for (const size of chunkSizes) {
    assert.ok(size <= 100, `chunk size ${size} exceeded 100`);
  }
  assert.strictEqual(
    chunkSizes.reduce((a, b) => a + b, 0),
    recipientCount,
  );
});

test("send error surfaces so the cron worker can retry the job", async () => {
  const supabase = createSupabaseStub();
  const expo = createExpoStub();

  supabase.seed("organizations", [{ id: orgId, slug: "team" }]);
  supabase.seed("user_organization_roles", [
    {
      organization_id: orgId,
      user_id: userId(1),
      role: "active_member",
      status: "active",
    },
  ]);
  supabase.seed("user_push_tokens", [
    { user_id: userId(1), expo_push_token: expoToken(1) },
  ]);
  expo.failNextSend(new Error("Expo HTTP 503"));

  const result = await sendPush({
    supabase: supabase as never,
    organizationId: orgId,
    audience: "members",
    title: "x",
    body: "y",
    category: "announcement",
    forceInline: true,
    expoClient: expo,
  });

  assert.strictEqual(result.sent, 0);
  assert.match(result.errors.join("\n"), /Expo HTTP 503/);
});
