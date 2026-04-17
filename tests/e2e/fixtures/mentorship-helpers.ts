import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  type APIRequestContext,
  type BrowserContext,
  type Browser,
  expect,
  request as playwrightRequest,
} from "@playwright/test";
import { TestData } from "./test-data";

/**
 * Helpers for the mentorship Phase 2 E2E suite.
 *
 * These helpers keep the spec file focused on assertions and avoid repeating
 * the service-client / login-a-secondary-user ceremony in every test.
 */

const REQUIRED_ENVS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "E2E_ORG_ID",
  "E2E_MENTOR_EMAIL",
  "E2E_MENTOR_PASSWORD",
  "E2E_MENTOR_USER_ID",
  "E2E_MENTEE_EMAIL",
  "E2E_MENTEE_PASSWORD",
  "E2E_MENTEE_USER_ID",
  "CRON_SECRET",
] as const;

export function mentorshipEnvMissing(): string[] {
  return REQUIRED_ENVS.filter((name) => !process.env[name]);
}

/**
 * Lazily construct a service-role Supabase client for the test suite. We only
 * connect when tests actually run so missing-env suites skip cleanly.
 */
export function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Log a secondary user in via the UI and return an APIRequestContext that
 * carries that user's cookies. Used so a single spec can act as both mentor
 * and admin without disturbing the shared storageState.
 */
export async function loginAsUser(
  browser: Browser,
  email: string,
  password: string,
): Promise<{ context: BrowserContext; request: APIRequestContext }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/auth/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL((url) => !url.pathname.includes("/auth/login"), {
    timeout: 30000,
  });
  await page.close();
  return { context, request: context.request };
}

/**
 * Build a standalone request context with no auth — useful for the cron
 * endpoint and for confirming unauthenticated responses.
 */
export async function newAnonRequest(
  baseURL: string | undefined,
): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL });
}

export interface SeededPair {
  id: string;
  mentorUserId: string;
  menteeUserId: string;
  organizationId: string;
}

/**
 * Insert a mentorship_pair row and register it for teardown.
 */
export async function seedProposedPair(
  supabase: SupabaseClient,
  opts: {
    organizationId: string;
    mentorUserId: string;
    menteeUserId: string;
    proposedAt?: string;
  },
): Promise<SeededPair> {
  const insertRow = {
    organization_id: opts.organizationId,
    mentor_user_id: opts.mentorUserId,
    mentee_user_id: opts.menteeUserId,
    status: "proposed" as const,
    ...(opts.proposedAt ? { proposed_at: opts.proposedAt } : {}),
  };

  const { data, error } = await (supabase as unknown as {
    from: (t: string) => {
      insert: (v: unknown) => {
        select: (cols: string) => {
          single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
        };
      };
    };
  })
    .from("mentorship_pairs")
    .insert(insertRow)
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to seed mentorship_pair: ${error?.message ?? "no data"}`);
  }

  return {
    id: data.id,
    mentorUserId: opts.mentorUserId,
    menteeUserId: opts.menteeUserId,
    organizationId: opts.organizationId,
  };
}

/**
 * Clean up all mentorship pairs and audit log entries between two users in an
 * org. Safe to call before each test to guarantee a clean slate.
 */
export async function clearMentorshipRowsBetween(
  supabase: SupabaseClient,
  opts: { organizationId: string; mentorUserId: string; menteeUserId: string },
): Promise<void> {
  const client = supabase as unknown as {
    from: (t: string) => {
      delete: () => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => {
            eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>;
          };
        };
      };
    };
  };

  await client
    .from("mentorship_audit_log")
    .delete()
    .eq("organization_id", opts.organizationId)
    .eq("actor_user_id", opts.mentorUserId)
    .eq("kind", "proposal_accepted");

  // Delete pairs (audit log rows FK-cascade to null on pair delete, so the
  // above was only to remove mentor-actor audit noise; do broad cleanup too).
  await (supabase as unknown as {
    from: (t: string) => {
      delete: () => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => {
            eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>;
          };
        };
      };
    };
  })
    .from("mentorship_pairs")
    .delete()
    .eq("organization_id", opts.organizationId)
    .eq("mentor_user_id", opts.mentorUserId)
    .eq("mentee_user_id", opts.menteeUserId);
}

export async function deleteChatGroupsBetween(
  supabase: SupabaseClient,
  opts: { organizationId: string; userAId: string; userBId: string },
): Promise<void> {
  // Find 2-member chat groups between the pair and hard-delete them so repeat
  // runs always start from a fresh "chat bootstrapped" state.
  const { data: memberships } = await supabase
    .from("chat_group_members")
    .select("chat_group_id,user_id")
    .eq("organization_id", opts.organizationId)
    .in("user_id", [opts.userAId, opts.userBId]);

  const rows = (memberships ?? []) as Array<{ chat_group_id: string; user_id: string }>;
  const byGroup = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = byGroup.get(row.chat_group_id) ?? new Set<string>();
    set.add(row.user_id);
    byGroup.set(row.chat_group_id, set);
  }

  const pairGroupIds = [...byGroup.entries()]
    .filter(([, ids]) => ids.has(opts.userAId) && ids.has(opts.userBId))
    .map(([groupId]) => groupId);

  if (pairGroupIds.length === 0) return;

  await supabase.from("chat_group_members").delete().in("chat_group_id", pairGroupIds);
  await supabase.from("chat_messages").delete().in("chat_group_id", pairGroupIds);
  await supabase.from("chat_groups").delete().in("id", pairGroupIds);
}

/**
 * Fetch a single mentorship_pair by id. Returns null if not found.
 */
export async function getPair(
  supabase: SupabaseClient,
  pairId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await supabase
    .from("mentorship_pairs")
    .select("*")
    .eq("id", pairId)
    .maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}

export async function getAuditLogForPair(
  supabase: SupabaseClient,
  pairId: string,
): Promise<Array<{ kind: string; metadata: unknown }>> {
  const { data } = await supabase
    .from("mentorship_audit_log")
    .select("kind,metadata")
    .eq("pair_id", pairId)
    .order("created_at", { ascending: true });
  return (data as Array<{ kind: string; metadata: unknown }> | null) ?? [];
}

/**
 * Confirm required env-vars or skip the test. Throw so test.skip records a
 * clear reason.
 */
export function requireMentorshipEnv(): void {
  const missing = mentorshipEnvMissing();
  if (missing.length > 0) {
    throw new Error(
      `Mentorship Phase 2 e2e suite requires: ${missing.join(", ")}`,
    );
  }
}

/**
 * Helper: collect [status, body] from multiple concurrent fetches.
 */
export async function collectResponses<T>(
  promises: Array<Promise<{ status: number; body: T }>>,
): Promise<Array<{ status: number; body: T }>> {
  return Promise.all(promises);
}

export async function patchPair(
  request: APIRequestContext,
  opts: {
    organizationId: string;
    pairId: string;
    action: "accept" | "decline" | "override_approve";
    reason?: string;
  },
): Promise<{ status: number; body: unknown }> {
  const response = await request.patch(
    `/api/organizations/${opts.organizationId}/mentorship/pairs/${opts.pairId}`,
    {
      data: {
        action: opts.action,
        ...(opts.reason ? { reason: opts.reason } : {}),
      },
    },
  );
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep as text
  }
  return { status: response.status(), body };
}

export async function postRequest(
  request: APIRequestContext,
  opts: { organizationId: string; mentorUserId: string },
): Promise<{ status: number; body: unknown }> {
  const response = await request.post(
    `/api/organizations/${opts.organizationId}/mentorship/requests`,
    {
      data: { mentor_user_id: opts.mentorUserId },
    },
  );
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep as text
  }
  return { status: response.status(), body };
}

/**
 * POST the admin run-round endpoint. Matches the current route which accepts
 * POST with no body and executes a single matching round.
 */
export async function runAdminMatchRound(
  request: APIRequestContext,
  organizationId: string,
): Promise<{ status: number; body: unknown }> {
  const response = await request.post(
    `/api/organizations/${organizationId}/mentorship/admin/queue`,
    { data: {} },
  );
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep as text
  }
  return { status: response.status(), body };
}

export async function triggerCronExpire(
  request: APIRequestContext,
  opts: { authorization?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {};
  if (opts.authorization !== undefined) {
    headers.authorization = opts.authorization;
  }
  const response = await request.get("/api/cron/mentor-match-expire", { headers });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep as text
  }
  return { status: response.status(), body };
}

export { expect, TestData };
