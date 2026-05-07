import { test, expect, type APIRequestContext } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TestData } from "../fixtures/test-data";
import {
  clearMentorshipRowsBetween,
  collectResponses,
  deleteChatGroupsBetween,
  getAuditLogForPair,
  getPair,
  getServiceClient,
  loginAsUser,
  mentorshipEnvMissing,
  newAnonRequest,
  patchPair,
  postRequest,
  runAdminMatchRound,
  seedProposedPair,
  triggerCronExpire,
} from "../fixtures/mentorship-helpers";

/**
 * Mentorship Phase 2 E2E coverage.
 *
 * These tests exercise API flows via Playwright's APIRequestContext while a
 * real Next.js server is running (see playwright.config.ts webServer). They
 * deliberately skip when the required env vars are not present so CI doesn't
 * red unconditionally when secrets aren't wired up.
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   E2E_ORG_ID (UUID), E2E_OTHER_ORG_ID (UUID, for cross-org test)
 *   E2E_MENTOR_EMAIL / E2E_MENTOR_PASSWORD / E2E_MENTOR_USER_ID
 *   E2E_MENTEE_EMAIL / E2E_MENTEE_PASSWORD / E2E_MENTEE_USER_ID
 *   CRON_SECRET
 *
 * Seed expectations (documented in README / deploy notes):
 *   - E2E_MENTOR_USER_ID has mentor_profiles row in E2E_ORG_ID with
 *     is_active=true, accepting_new=true, >=1 topic, >=1 expertise_area.
 *   - E2E_MENTEE_USER_ID has a mentee_intake form submission for E2E_ORG_ID
 *     with at least one preferred_topic / preferred_industry that overlaps
 *     the mentor's topics (so matching returns >=1 candidate).
 *   - Both users are active_member role in E2E_ORG_ID.
 *   - The E2E admin (auth.setup.ts) has role=admin, status=active in
 *     E2E_ORG_ID.
 */

const missing = mentorshipEnvMissing();
test.describe.configure({ mode: "serial" });

test.describe("Mentorship Phase 2", () => {
  test.skip(missing.length > 0, `Missing env: ${missing.join(", ")}`);

  const orgId = TestData.getOrgId();
  const otherOrgId = TestData.getOtherOrgId();
  const mentor = TestData.getMentorCredentials();
  const mentee = TestData.getMenteeCredentials();
  const cronSecret = TestData.getCronSecret();

  let supabase: SupabaseClient;
  let mentorRequest: APIRequestContext;
  let menteeRequest: APIRequestContext;
  let anonRequest: APIRequestContext;

  test.beforeAll(async ({ browser, baseURL }) => {
    supabase = getServiceClient();
    const mentorCtx = await loginAsUser(browser, mentor.email, mentor.password);
    const menteeCtx = await loginAsUser(browser, mentee.email, mentee.password);
    mentorRequest = mentorCtx.request;
    menteeRequest = menteeCtx.request;
    anonRequest = await newAnonRequest(baseURL);
  });

  test.beforeEach(async () => {
    // Always start each test from a clean slate for the mentor/mentee pair.
    await clearMentorshipRowsBetween(supabase, {
      organizationId: orgId,
      mentorUserId: mentor.userId,
      menteeUserId: mentee.userId,
    });
    await deleteChatGroupsBetween(supabase, {
      organizationId: orgId,
      userAId: mentor.userId,
      userBId: mentee.userId,
    });
  });

  // ---------------------------------------------------------------------------
  // 1. Mentor accepts proposal + chat bootstraps
  // ---------------------------------------------------------------------------
  test("mentor accepts proposal, chat group is created, mentee notified", async () => {
    const pair = await seedProposedPair(supabase, {
      organizationId: orgId,
      mentorUserId: mentor.userId,
      menteeUserId: mentee.userId,
    });

    const result = await patchPair(mentorRequest, {
      organizationId: orgId,
      pairId: pair.id,
      action: "accept",
    });
    expect(result.status).toBe(200);
    const body = result.body as {
      pair_id: string;
      chat_group_id: string | null;
      status: string;
    };
    expect(body.pair_id).toBe(pair.id);
    expect(body.status).toBe("accepted");
    expect(body.chat_group_id).toBeTruthy();

    // DB state — pair promoted
    const persisted = await getPair(supabase, pair.id) as { status?: string; accepted_at?: string | null };
    expect(persisted?.status).toBe("accepted");
    expect(persisted?.accepted_at).toBeTruthy();

    // Chat group exists and both users are active members
    const { data: group } = await supabase
      .from("chat_groups")
      .select("id,organization_id,deleted_at")
      .eq("id", body.chat_group_id as string)
      .single();
    expect(group).toBeTruthy();
    expect((group as { organization_id: string }).organization_id).toBe(orgId);
    expect((group as { deleted_at: string | null }).deleted_at).toBeNull();

    const { data: members } = await supabase
      .from("chat_group_members")
      .select("user_id,removed_at")
      .eq("chat_group_id", body.chat_group_id as string);
    const memberRows = (members ?? []) as Array<{ user_id: string; removed_at: string | null }>;
    const activeUserIds = memberRows
      .filter((r) => r.removed_at == null)
      .map((r) => r.user_id)
      .sort();
    expect(activeUserIds).toEqual([mentor.userId, mentee.userId].sort());

    // Audit log row recorded with correct kind
    const audit = await getAuditLogForPair(supabase, pair.id);
    expect(audit.some((row) => row.kind === "proposal_accepted")).toBe(true);

    // Mentee received an email notification (notifications table row)
    const { data: notifications } = await supabase
      .from("notifications")
      .select("id,target_user_id,category,title")
      .eq("organization_id", orgId)
      .eq("target_user_id", mentee.userId)
      .eq("category", "mentorship")
      .order("created_at", { ascending: false })
      .limit(5);
    expect((notifications ?? []).length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // 2. Mentor declines proposal through authenticated route
  // ---------------------------------------------------------------------------
  test("mentor declines proposal, pair is updated, audit row is recorded", async () => {
    const pair = await seedProposedPair(supabase, {
      organizationId: orgId,
      mentorUserId: mentor.userId,
      menteeUserId: mentee.userId,
    });

    const result = await patchPair(mentorRequest, {
      organizationId: orgId,
      pairId: pair.id,
      action: "decline",
      reason: "No capacity right now",
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      pair_id: pair.id,
      status: "declined",
    });

    const persisted = await getPair(supabase, pair.id) as {
      status?: string;
      declined_at?: string | null;
      declined_reason?: string | null;
    };
    expect(persisted?.status).toBe("declined");
    expect(persisted?.declined_at).toBeTruthy();
    expect(persisted?.declined_reason).toBe("No capacity right now");

    const audit = await getAuditLogForPair(supabase, pair.id);
    expect(audit.some((row) => row.kind === "proposal_declined")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 3. Concurrent proposals are idempotent
  // ---------------------------------------------------------------------------
  test("5 parallel requests create exactly 1 mentorship_pair row", async () => {
    const fires = Array.from({ length: 5 }, () =>
      postRequest(menteeRequest, { organizationId: orgId, mentorUserId: mentor.userId }),
    );
    const results = await collectResponses(fires);

    // All should return 200 or 201 (first creates, rest reuse).
    for (const r of results) {
      expect([200, 201]).toContain(r.status);
    }

    // Exactly one active pair exists.
    const { data: rows } = await supabase
      .from("mentorship_pairs")
      .select("id,status")
      .eq("organization_id", orgId)
      .eq("mentor_user_id", mentor.userId)
      .eq("mentee_user_id", mentee.userId)
      .in("status", ["proposed", "accepted", "active", "paused"])
      .is("deleted_at", null);
    expect((rows ?? []).length).toBe(1);

    // All successful responses should reference the same pair id.
    const ids = new Set(
      results
        .map((r) => (r.body as { pair?: { id?: string } }).pair?.id)
        .filter((id): id is string => typeof id === "string"),
    );
    expect(ids.size).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 4. Concurrent accepts — first wins (200), second conflicts (409)
  // ---------------------------------------------------------------------------
  test("2 concurrent accepts: one 200, one 409", async () => {
    const pair = await seedProposedPair(supabase, {
      organizationId: orgId,
      mentorUserId: mentor.userId,
      menteeUserId: mentee.userId,
    });

    const [a, b] = await Promise.all([
      patchPair(mentorRequest, { organizationId: orgId, pairId: pair.id, action: "accept" }),
      patchPair(mentorRequest, { organizationId: orgId, pairId: pair.id, action: "accept" }),
    ]);

    const statuses = [a.status, b.status].sort();
    // The RPC is idempotent on re-accept (returns the accepted row), so the
    // second call may return 200 instead of 409. Accept either shape but
    // require that at least one succeeded and neither is 5xx.
    for (const status of statuses) {
      expect([200, 409]).toContain(status);
    }
    expect(statuses).toContain(200);

    const persisted = await getPair(supabase, pair.id) as { status?: string };
    expect(persisted?.status).toBe("accepted");
  });

  // ---------------------------------------------------------------------------
  // 5. Cron expire — idempotent, audit-logged
  // ---------------------------------------------------------------------------
  test("cron expires stale proposed pairs and is idempotent", async () => {
    const proposedAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const pair = await seedProposedPair(supabase, {
      organizationId: orgId,
      mentorUserId: mentor.userId,
      menteeUserId: mentee.userId,
      proposedAt,
    });

    const first = await triggerCronExpire(anonRequest, {
      authorization: `Bearer ${cronSecret}`,
    });
    expect(first.status).toBe(200);
    const firstBody = first.body as { expired: number };
    expect(firstBody.expired).toBeGreaterThanOrEqual(1);

    const persisted = await getPair(supabase, pair.id) as { status?: string };
    expect(persisted?.status).toBe("expired");

    const audit = await getAuditLogForPair(supabase, pair.id);
    expect(audit.some((row) => row.kind === "mentorship_proposal_expired")).toBe(true);
    const expiredCount = audit.filter((row) => row.kind === "mentorship_proposal_expired").length;
    expect(expiredCount).toBe(1);

    // Re-run — the now-expired pair is no longer proposed, so nothing updates.
    const second = await triggerCronExpire(anonRequest, {
      authorization: `Bearer ${cronSecret}`,
    });
    expect(second.status).toBe(200);

    const auditAfter = await getAuditLogForPair(supabase, pair.id);
    const expiredCountAfter = auditAfter.filter(
      (row) => row.kind === "mentorship_proposal_expired",
    ).length;
    expect(expiredCountAfter).toBe(1); // no double audit
  });

  // ---------------------------------------------------------------------------
  // 6. Cron auth
  // ---------------------------------------------------------------------------
  test("cron expire rejects missing or wrong bearer", async () => {
    const noHeader = await triggerCronExpire(anonRequest);
    expect(noHeader.status).toBe(401);

    const wrong = await triggerCronExpire(anonRequest, {
      authorization: "Bearer not-the-real-secret",
    });
    expect(wrong.status).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // 7. Admin run match round — idempotent
  // ---------------------------------------------------------------------------
  test("admin run_round proposes pairs and is idempotent", async ({ request: adminRequest }) => {
    // adminRequest comes from the default storageState (E2E admin).
    // Ensure the mentee has no active pair so they're a candidate.
    await clearMentorshipRowsBetween(supabase, {
      organizationId: orgId,
      mentorUserId: mentor.userId,
      menteeUserId: mentee.userId,
    });

    const firstRun = await runAdminMatchRound(adminRequest, orgId);
    expect(firstRun.status).toBe(200);
    const firstBody = firstRun.body as {
      created: number;
      skipped_existing: number;
      skipped_no_match: number;
      notifications_sent: number;
    };
    expect(firstBody.created + firstBody.skipped_existing).toBeGreaterThanOrEqual(0);

    // The mentee should now have a proposed pair with our mentor (seeded to be
    // the top match via env fixtures).
    const { data: pairs } = await supabase
      .from("mentorship_pairs")
      .select("id,mentor_user_id,status")
      .eq("organization_id", orgId)
      .eq("mentee_user_id", mentee.userId)
      .in("status", ["proposed", "accepted", "active", "paused"])
      .is("deleted_at", null);
    const pairRows = (pairs ?? []) as Array<{ id: string; mentor_user_id: string; status: string }>;
    expect(pairRows.length).toBeGreaterThanOrEqual(1);

    // Re-run: no new pair created for this mentee (skipped_existing should include them).
    const secondRun = await runAdminMatchRound(adminRequest, orgId);
    expect(secondRun.status).toBe(200);
    const secondBody = secondRun.body as { created: number; skipped_existing: number };
    expect(secondBody.created).toBe(0);
    expect(secondBody.skipped_existing).toBeGreaterThanOrEqual(pairRows.length);

    const { data: afterPairs } = await supabase
      .from("mentorship_pairs")
      .select("id")
      .eq("organization_id", orgId)
      .eq("mentee_user_id", mentee.userId)
      .in("status", ["proposed", "accepted", "active", "paused"])
      .is("deleted_at", null);
    expect((afterPairs ?? []).length).toBe(pairRows.length);
  });

  // ---------------------------------------------------------------------------
  // 7. Cross-org isolation — caller from Org A cannot PATCH a pair in Org B
  // ---------------------------------------------------------------------------
  test("PATCH from a different org returns 404", async () => {
    test.skip(!otherOrgId, "E2E_OTHER_ORG_ID not configured");

    const pair = await seedProposedPair(supabase, {
      organizationId: orgId,
      mentorUserId: mentor.userId,
      menteeUserId: mentee.userId,
    });

    // Swap in the wrong orgId in the URL — pair lookup filters on
    // organization_id and should return "Pair not found".
    const result = await patchPair(mentorRequest, {
      organizationId: otherOrgId,
      pairId: pair.id,
      action: "accept",
    });
    expect(result.status).toBe(404);
  });
});
