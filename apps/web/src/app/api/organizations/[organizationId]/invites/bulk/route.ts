import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, baseSchemas } from "@/lib/security/validation";
import { orgBulkInviteSchema } from "@/lib/schemas/invite";
import { sendEmail } from "@/lib/notifications";
import { buildInviteLink } from "@/lib/invites/buildInviteLink";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONCURRENCY = 10;

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

interface EmailResult {
  email: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
}

export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;

  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "org-bulk-invite",
    limitPerIp: 5,
    limitPerUser: 3,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) {
    return respond({ error: "Unauthorized" }, 401);
  }

  const serviceSupabase = createServiceClient();
  const { data: roleData, error: roleError } = await serviceSupabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  if (roleError) {
    console.error("[org/invites/bulk POST] Failed to fetch role:", roleError);
    return respond({ error: "Unable to verify permissions" }, 500);
  }

  if (roleData?.role !== "admin") {
    return respond({ error: "Forbidden" }, 403);
  }

  let body: z.infer<typeof orgBulkInviteSchema>;
  try {
    body = await validateJson(req, orgBulkInviteSchema, { maxBodyBytes: 16_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return respond({ error: error.message, details: error.details }, 422);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  const { emails, role, expiresAt, requireApproval } = body;
  const uniqueEmails = emails;

  // Create a single invite code with uses = emails.length via the authenticated
  // client so auth.uid() is available inside the RPC.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invite, error: rpcError } = await (supabase as any).rpc("create_org_invite", {
    p_organization_id: organizationId,
    p_role: role,
    p_uses: uniqueEmails.length,
    p_expires_at: expiresAt ?? null,
    p_require_approval: requireApproval ?? null,
  });

  if (rpcError || !invite) {
    console.error("[org/invites/bulk POST] RPC error:", rpcError);
    return respond({ error: rpcError?.message || "Failed to create invite" }, 500);
  }

  const inviteLink = buildInviteLink({
    kind: role === "parent" ? "parent" : "org",
    baseUrl: new URL(req.url).origin,
    orgId: organizationId,
    code: invite.code,
    token: invite.token ?? undefined,
  });

  const hasResend = !!process.env.RESEND_API_KEY;

  if (!hasResend) {
    // No email service — return invite link for manual sharing
    const { data: orgSlugRow } = await serviceSupabase
      .from("organizations")
      .select("slug")
      .eq("id", organizationId)
      .maybeSingle();

    if (orgSlugRow?.slug) {
      revalidatePath(`/${orgSlugRow.slug}/settings/invites`);
    }

    return respond({
      emailsDelivered: false,
      invite: { id: invite.id, code: invite.code, token: invite.token, link: inviteLink },
      summary: { success: 0, failed: 0, skipped: uniqueEmails.length, total: uniqueEmails.length },
      results: uniqueEmails.map((email) => ({ email, status: "skipped" as const })),
    });
  }

  // Fetch org name and slug for email body and cache revalidation
  const { data: orgRow } = await serviceSupabase
    .from("organizations")
    .select("slug, name")
    .eq("id", organizationId)
    .maybeSingle();

  const orgName = orgRow?.name || "your organization";

  // Fan out emails in batches of CONCURRENCY
  const emailTasks = uniqueEmails.map((email) => async (): Promise<EmailResult> => {
    try {
      const result = await sendEmail({
        to: email,
        subject: `You're invited to join ${orgName}`,
        body: `You've been invited to join ${orgName}.\n\nJoin using this link: ${inviteLink}\n\nOr use invite code: ${invite.code}`,
      });
      return result.success
        ? { email, status: "sent" }
        : { email, status: "failed", error: "Email delivery failed" };
    } catch (err) {
      return {
        email,
        status: "failed",
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  });

  const results: EmailResult[] = [];
  for (let i = 0; i < emailTasks.length; i += CONCURRENCY) {
    const batch = emailTasks.slice(i, i + CONCURRENCY).map((task) => task());
    const batchResults = await Promise.allSettled(batch);
    for (const res of batchResults) {
      if (res.status === "fulfilled") {
        results.push(res.value);
      } else {
        results.push({ email: uniqueEmails[results.length], status: "failed", error: "Unexpected error" });
      }
    }
  }

  const successCount = results.filter((r) => r.status === "sent").length;
  const failedCount = results.filter((r) => r.status === "failed").length;

  if (orgRow?.slug) {
    revalidatePath(`/${orgRow.slug}/settings/invites`);
  }

  return respond({
    emailsDelivered: true,
    invite: { id: invite.id, code: invite.code, token: invite.token, link: inviteLink },
    summary: { success: successCount, failed: failedCount, skipped: 0, total: uniqueEmails.length },
    results,
  });
}
