import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas, validateJson, ValidationError } from "@/lib/security/validation";
import { sendEmail } from "@/lib/notifications";
import { buildInviteLink } from "@/lib/invites/buildInviteLink";
import { getAppUrl } from "@/lib/url";

// Durable per-alumnus cooldown. The DB column `last_invite_sent_at` is the real
// gate (the in-memory rate limiter is only per-instance burst protection), so a
// re-invite is refused if the alumnus was invited within this window.
const REINVITE_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

// Send fan-out matches the CSV-import re-invite path.
const CONCURRENCY = 10;

const reInviteSchema = z.object({
  alumniIds: z.array(baseSchemas.uuid).min(1).max(200),
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

type SkipReason = "cooldown" | "linked" | "no_email" | "not_found";

interface ReInviteResult {
  alumniId: string;
  // `sent_unstamped`: the email went out but the durable cooldown stamp failed,
  // so the 14-day gate is NOT recorded for this recipient. Surfaced distinctly
  // (not as a clean `sent`) so an immediate re-send can't silently bypass the
  // cooldown unnoticed.
  status: "sent" | "sent_unstamped" | "skipped" | "failed";
  reason?: SkipReason | "send_failed" | "stamp_failed";
}

interface AlumniReInviteRow {
  id: string;
  user_id: string | null;
  email: string | null;
  first_name: string | null;
  last_invite_sent_at: string | null;
  invite_count: number | null;
}

interface OrgInviteRpc {
  rpc: (
    fn: "create_org_invite",
    params: {
      p_organization_id: string;
      p_role: string;
      p_uses: number | null;
      p_expires_at: string | null;
    }
  ) => Promise<{
    data: { code?: string | null; token?: string | null } | null;
    error: { message: string } | null;
  }>;
}

// POST /api/organizations/:organizationId/alumni/re-invite
//
// Admin-only: re-invite a selected cohort of unclaimed alumni (user_id IS NULL,
// email present, non-deleted). Each target is gated by a durable 14-day
// cooldown. Shaped so a future cron could reuse it; no background send ships.
export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  if (!baseSchemas.uuid.safeParse(organizationId).success) {
    return NextResponse.json({ error: "Invalid identifier" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "alumni re-invite",
    limitPerIp: 20,
    limitPerUser: 15,
  });
  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) {
    return respond({ error: "Unauthorized" }, 401);
  }

  let body: z.infer<typeof reInviteSchema>;
  try {
    body = await validateJson(req, reInviteSchema, { maxBodyBytes: 20_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return respond({ error: error.message, details: error.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  const serviceSupabase = createServiceClient();

  let membership;
  try {
    membership = await getOrgMembership(serviceSupabase, user.id, organizationId);
  } catch (error) {
    console.error("[alumni/re-invite POST] Failed to verify membership:", error);
    return respond({ error: "Unable to verify permissions" }, 500);
  }

  if (membership?.role !== "admin") {
    return respond({ error: "Forbidden" }, 403);
  }

  const alumniIds = [...new Set(body.alumniIds)];

  // Load every requested alumnus, org-scoped + non-deleted. Rows that aren't
  // returned (wrong org, soft-deleted, bad id) become per-id "not_found" skips.
  // The invite-tracking columns are new (generated DB types lag the migration),
  // so this query runs through an any-typed client, mirroring import-csv.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: alumniData, error: alumniError } = await (serviceSupabase as any)
    .from("alumni")
    .select("id, user_id, email, first_name, last_invite_sent_at, invite_count")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .in("id", alumniIds);

  if (alumniError) {
    console.error("[alumni/re-invite POST] Failed to load alumni:", alumniError);
    return respond({ error: "Failed to load alumni" }, 500);
  }

  const byId = new Map<string, AlumniReInviteRow>();
  for (const row of (alumniData ?? []) as AlumniReInviteRow[]) {
    byId.set(row.id, row);
  }

  const nowMs = Date.now();
  const results: ReInviteResult[] = [];
  const sendable: AlumniReInviteRow[] = [];

  // Partition requested ids into immediate skips vs. sendable targets. A row is
  // sendable only if unclaimed, has an email, and is past its cooldown.
  for (const id of alumniIds) {
    const row = byId.get(id);
    if (!row) {
      results.push({ alumniId: id, status: "skipped", reason: "not_found" });
      continue;
    }
    if (row.user_id) {
      results.push({ alumniId: id, status: "skipped", reason: "linked" });
      continue;
    }
    if (!row.email) {
      results.push({ alumniId: id, status: "skipped", reason: "no_email" });
      continue;
    }
    if (
      row.last_invite_sent_at &&
      nowMs - Date.parse(row.last_invite_sent_at) < REINVITE_COOLDOWN_MS
    ) {
      results.push({ alumniId: id, status: "skipped", reason: "cooldown" });
      continue;
    }
    sendable.push(row);
  }

  if (sendable.length > 0) {
    const sendResults = await sendCohortInvites({
      serviceSupabase,
      userSupabase: supabase,
      organizationId,
      actorUserId: user.id,
      sendable,
      nowMs,
    });
    results.push(...sendResults);
  }

  // `sent_unstamped` emails reached the recipient, so they count toward `sent`;
  // `sentUnstamped` surfaces the cooldown-bookkeeping miss separately.
  const sentUnstamped = results.filter((r) => r.status === "sent_unstamped").length;
  const sent = results.filter((r) => r.status === "sent").length + sentUnstamped;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;

  return respond({ sent, sentUnstamped, skipped, failed, results });
}

interface SendCohortInput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serviceSupabase: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userSupabase: any;
  organizationId: string;
  actorUserId: string;
  sendable: AlumniReInviteRow[];
  nowMs: number;
}

/**
 * Create one alumni invite for the cohort, then email each target and stamp its
 * cooldown on success. Mirrors the CSV-import re-invite path: create_org_invite
 * runs through the *user* client (it is SECURITY DEFINER and checks the caller's
 * admin role via auth.uid()), then sendEmail fans out at CONCURRENCY.
 */
async function sendCohortInvites(input: SendCohortInput): Promise<ReInviteResult[]> {
  const { serviceSupabase, userSupabase, organizationId, actorUserId, sendable, nowMs } = input;

  const { data: invite, error: inviteError } = await (userSupabase as OrgInviteRpc).rpc(
    "create_org_invite",
    {
      p_organization_id: organizationId,
      p_role: "alumni",
      p_uses: sendable.length,
      p_expires_at: null,
    }
  );

  if (inviteError || !invite) {
    console.error("[alumni/re-invite POST] Failed to create invite:", inviteError);
    // The whole cohort fails to send — no cooldown stamped, so a retry is clean.
    return sendable.map((row) => ({
      alumniId: row.id,
      status: "failed" as const,
      reason: "send_failed" as const,
    }));
  }

  const { data: orgData } = await serviceSupabase
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();

  const orgName = orgData?.name ?? "your alumni network";
  const joinLink = buildInviteLink({
    kind: "org",
    baseUrl: getAppUrl(),
    orgId: organizationId,
    code: invite.code ?? null,
    token: invite.token ?? null,
  });

  const sentAt = new Date(nowMs).toISOString();

  const tasks = sendable.map((row) => async (): Promise<ReInviteResult> => {
    const emailResult = await sendEmail({
      to: row.email as string,
      subject: `You've been added to ${orgName}'s alumni network`,
      body: [
        `Hi ${row.first_name ?? "there"},`,
        "",
        `You've been added to ${orgName}'s alumni network on TeamNetwork.`,
        "",
        `Click the link below to join and access your alumni profile:`,
        joinLink,
        "",
        "If you have any questions, reply to this email.",
        "",
        "Best regards,",
        `The ${orgName} Team`,
      ].join("\n"),
    });

    // sendEmail never throws; a non-success result is a per-recipient failure.
    // Do NOT bump the cooldown on failure — that would falsely block a retry.
    if (!emailResult.success) {
      return { alumniId: row.id, status: "failed", reason: "send_failed" };
    }

    // Stamp the durable cooldown + bump the counter. supabase-js can't do an
    // atomic `col + 1` in .update(), so increment from the row we loaded; the
    // ids are deduped and an admin sends once, so there's no concurrent writer.
    const { error: updateError } = await serviceSupabase
      .from("alumni")
      .update({
        last_invite_sent_at: sentAt,
        invite_count: (row.invite_count ?? 0) + 1,
      })
      .eq("id", row.id)
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .is("user_id", null);

    // The email already went out, so we always audit (below). But if the
    // cooldown stamp failed, the durable 14-day gate is NOT recorded — report
    // `sent_unstamped` rather than a clean `sent` so an immediate re-send can't
    // silently slip past the cooldown.
    const stamped = !updateError;
    if (updateError) {
      console.error("[alumni/re-invite POST] Failed to stamp cooldown:", updateError);
    }

    // Audit trail — mirror the link-user route's direct insert into the
    // org-scoped admin audit table (TEXT resource_type, service-role-only RLS).
    // Written whether or not the stamp succeeded: it records that this alumnus
    // was actually emailed, which is exactly the fact a missed cooldown needs.
    const { error: auditError } = await serviceSupabase.from("data_access_log").insert({
      actor_user_id: actorUserId,
      resource_type: "alumni_reinvite",
      resource_id: row.id,
      organization_id: organizationId,
    });
    if (auditError) {
      console.error("[alumni/re-invite POST] Failed to write audit log:", auditError);
    }

    return stamped
      ? { alumniId: row.id, status: "sent" }
      : { alumniId: row.id, status: "sent_unstamped", reason: "stamp_failed" };
  });

  const results: ReInviteResult[] = [];
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const batch = tasks.slice(i, i + CONCURRENCY).map((task) => task());
    const settled = await Promise.allSettled(batch);
    for (let j = 0; j < settled.length; j++) {
      const res = settled[j];
      if (res.status === "fulfilled") {
        results.push(res.value);
      } else {
        console.error("[alumni/re-invite POST] Send task rejected:", res.reason);
        results.push({
          alumniId: sendable[i + j].id,
          status: "failed",
          reason: "send_failed",
        });
      }
    }
  }

  return results;
}
