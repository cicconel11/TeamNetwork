import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import { performBrightDataSync } from "@/lib/linkedin/resync";

const USER_ID = "33333333-3333-4333-8333-333333333333";
const ORG_ID = "44444444-4444-4444-8444-444444444444";
const LINKEDIN_URL = "https://www.linkedin.com/in/jane-doe";
const ATTEMPT_ID = "55555555-5555-4555-8555-555555555555";

function seedMembershipContext(
  supabase: ReturnType<typeof createSupabaseStub>,
  options: { role?: string; enabled?: boolean } = {},
) {
  supabase.registerRpc("get_linkedin_manual_sync_status", () => ({
    remaining: 2,
    max_per_month: 2,
  }));
  supabase.seed("user_organization_roles", [{
    user_id: USER_ID,
    organization_id: ORG_ID,
    role: options.role ?? "active_member",
    status: "active",
  }]);
  supabase.seed("organizations", [{
    id: ORG_ID,
    linkedin_resync_enabled: options.enabled ?? true,
  }]);
}

test("performBrightDataSync succeeds for a URL-only member when Bright Data sync is enabled", async () => {
  const supabase = createSupabaseStub();
  seedMembershipContext(supabase);
  supabase.seed("members", [{
    user_id: USER_ID,
    linkedin_url: LINKEDIN_URL,
    deleted_at: null,
  }]);
  let completedAttemptId: string | null = null;
  supabase.registerRpc("reserve_linkedin_manual_sync", () => ({
    allowed: true,
    attempt_id: ATTEMPT_ID,
    remaining: 1,
  }));
  supabase.registerRpc("complete_linkedin_manual_sync", ({ p_attempt_id }) => {
    completedAttemptId = String(p_attempt_id);
    return { success: true };
  });

  const result = await performBrightDataSync(supabase as never, USER_ID, {
    isConfigured: () => true,
    runEnrichment: async (_client, userId, linkedinUrl) => {
      assert.equal(userId, USER_ID);
      assert.equal(linkedinUrl, LINKEDIN_URL);
      return { enriched: true };
    },
  });

  assert.deepEqual(result, {
    status: 200,
    body: {
      message: "LinkedIn data synced",
      remaining_syncs: 1,
    },
  });
  assert.equal(completedAttemptId, ATTEMPT_ID);
  assert.deepEqual(supabase.getRows("user_linkedin_connections"), []);
});

test("performBrightDataSync allows admins even when the org toggle is disabled", async () => {
  const supabase = createSupabaseStub();
  seedMembershipContext(supabase, { role: "admin", enabled: false });
  supabase.seed("alumni", [{
    user_id: USER_ID,
    linkedin_url: LINKEDIN_URL,
    deleted_at: null,
  }]);
  supabase.registerRpc("reserve_linkedin_manual_sync", () => ({
    allowed: true,
    attempt_id: ATTEMPT_ID,
    remaining: 0,
  }));
  supabase.registerRpc("complete_linkedin_manual_sync", () => ({ success: true }));

  const result = await performBrightDataSync(supabase as never, USER_ID, {
    isConfigured: () => true,
    runEnrichment: async () => ({ enriched: true }),
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.message, "LinkedIn data synced");
});

test("performBrightDataSync rejects non-admin members when the org toggle is disabled", async () => {
  const supabase = createSupabaseStub();
  seedMembershipContext(supabase, { enabled: false });
  supabase.seed("parents", [{
    user_id: USER_ID,
    linkedin_url: LINKEDIN_URL,
    deleted_at: null,
  }]);

  const result = await performBrightDataSync(supabase as never, USER_ID, {
    isConfigured: () => true,
    runEnrichment: async () => ({ enriched: true }),
  });

  assert.deepEqual(result, {
    status: 403,
    body: {
      error: "LinkedIn re-sync is not enabled for your organization.",
      remaining_syncs: undefined,
    },
  });
});

test("performBrightDataSync rejects users without a saved LinkedIn profile URL", async () => {
  const supabase = createSupabaseStub();
  seedMembershipContext(supabase);

  const result = await performBrightDataSync(supabase as never, USER_ID, {
    isConfigured: () => true,
    runEnrichment: async () => ({ enriched: true }),
  });

  assert.deepEqual(result, {
    status: 400,
    body: {
      error: "Save a valid LinkedIn profile URL before syncing LinkedIn data.",
    },
  });
});

test("performBrightDataSync returns 429 when the monthly quota is exhausted", async () => {
  const supabase = createSupabaseStub();
  seedMembershipContext(supabase);
  supabase.seed("members", [{
    user_id: USER_ID,
    linkedin_url: LINKEDIN_URL,
    deleted_at: null,
  }]);
  supabase.registerRpc("reserve_linkedin_manual_sync", () => ({
    allowed: false,
    reason: "rate_limited",
  }));

  const result = await performBrightDataSync(supabase as never, USER_ID, {
    isConfigured: () => true,
    runEnrichment: async () => ({ enriched: true }),
  });

  assert.deepEqual(result, {
    status: 429,
    body: {
      error: "You've reached your sync limit for this month (2 per month). Resets next month.",
      remaining_syncs: 0,
    },
  });
});

test("performBrightDataSync returns 503 when Bright Data is not configured", async () => {
  const supabase = createSupabaseStub();
  seedMembershipContext(supabase);
  supabase.seed("members", [{
    user_id: USER_ID,
    linkedin_url: LINKEDIN_URL,
    deleted_at: null,
  }]);

  const result = await performBrightDataSync(supabase as never, USER_ID, {
    isConfigured: () => false,
    runEnrichment: async () => ({ enriched: true }),
  });

  assert.deepEqual(result, {
    status: 503,
    body: {
      error: "Bright Data sync is not configured in this environment.",
    },
  });
});

test("performBrightDataSync keeps upstream Bright Data failures as 502 with a stable error", async () => {
  const supabase = createSupabaseStub();
  seedMembershipContext(supabase);
  supabase.seed("members", [{
    user_id: USER_ID,
    linkedin_url: LINKEDIN_URL,
    deleted_at: null,
  }]);
  let releasedAttemptId: string | null = null;
  supabase.registerRpc("reserve_linkedin_manual_sync", () => ({
    allowed: true,
    attempt_id: ATTEMPT_ID,
    remaining: 1,
  }));
  supabase.registerRpc("release_linkedin_manual_sync", ({ p_attempt_id }) => {
    releasedAttemptId = String(p_attempt_id);
    return { success: true };
  });

  const result = await performBrightDataSync(supabase as never, USER_ID, {
    isConfigured: () => true,
    runEnrichment: async () => ({
      enriched: false,
      failureKind: "upstream_error",
      error: "Bright Data rejected the profile lookup.",
    }),
  });

  assert.deepEqual(result, {
    status: 502,
    body: {
      error: "Bright Data rejected the profile lookup.",
      remaining_syncs: 1,
    },
  });
  assert.equal(releasedAttemptId, ATTEMPT_ID);
});

test("performBrightDataSync treats provider-level Bright Data access failures as 503 and releases the reservation", async () => {
  const supabase = createSupabaseStub();
  seedMembershipContext(supabase);
  supabase.seed("members", [{
    user_id: USER_ID,
    linkedin_url: LINKEDIN_URL,
    deleted_at: null,
  }]);
  let releasedAttemptId: string | null = null;
  supabase.registerRpc("reserve_linkedin_manual_sync", () => ({
    allowed: true,
    attempt_id: ATTEMPT_ID,
    remaining: 1,
  }));
  supabase.registerRpc("release_linkedin_manual_sync", ({ p_attempt_id }) => {
    releasedAttemptId = String(p_attempt_id);
    return { success: true };
  });

  const result = await performBrightDataSync(supabase as never, USER_ID, {
    isConfigured: () => true,
    runEnrichment: async () => ({
      enriched: false,
      failureKind: "provider_unavailable",
      error: "Bright Data LinkedIn Profiles API is unavailable for the configured account.",
    }),
  });

  assert.deepEqual(result, {
    status: 503,
    body: {
      error: "Bright Data LinkedIn Profiles API is unavailable for the configured account.",
      remaining_syncs: 1,
    },
  });
  assert.equal(releasedAttemptId, ATTEMPT_ID);
});
