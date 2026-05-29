import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, validationErrorResponse } from "@/lib/security/validation";
import { getEnterpriseApiContext, ENTERPRISE_OWNER_ROLE } from "@/lib/auth/enterprise-api-context";
import { logEnterpriseAuditAction, extractRequestContext } from "@/lib/audit/enterprise-audit";
import { enterpriseDeleteSchema } from "@/lib/schemas/enterprise";
import type { EnterpriseDeletionStatus } from "@/types/enterprise";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GRACE_PERIOD_DAYS = 30;

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = process.env.FROM_EMAIL || "noreply@myteamnetwork.com";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.myteamnetwork.com";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

interface DeletionRequestRow {
  id: string;
  status: "pending" | "completed" | "cancelled";
  requested_at: string;
  scheduled_deletion_at: string;
}

interface EnterpriseRow {
  name: string;
  slug: string;
  billing_contact_email: string | null;
}

function isMissingTable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

async function countAttachedOrgs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serviceSupabase: any,
  enterpriseId: string
): Promise<number> {
  // organizations has NO deleted_at column — orgs are hard-deleted. Unfiltered count.
  const { count } = await serviceSupabase
    .from("organizations")
    .select("id", { count: "exact", head: true })
    .eq("enterprise_id", enterpriseId);
  return count ?? 0;
}

/**
 * DELETE /api/enterprise/[enterpriseId]/deletion
 *
 * Owner-only. Initiates a 30-day soft delete with undo. Requires the same
 * confirmation phrase ("DELETE <ENTERPRISE_NAME>") typed into both inputs.
 * Blocked while any organization is still attached. Stripe is NOT touched here —
 * cancellation happens at purge so undo stays a pure DB flip.
 */
export async function DELETE(req: Request, { params }: RouteParams) {
  try {
    const { enterpriseId } = await params;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(req, {
      userId: user?.id ?? null,
      feature: "enterprise deletion",
      limitPerIp: 5,
      limitPerUser: 3,
      windowMs: 60 * 60 * 1000,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_OWNER_ROLE);
    if (!ctx.ok) return ctx.response;

    const respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    const body = await validateJson(req, enterpriseDeleteSchema, { maxBodyBytes: 1_000 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: enterprise, error: entError } = (await (ctx.serviceSupabase as any)
      .from("enterprises")
      .select("name, slug, billing_contact_email")
      .eq("id", ctx.enterpriseId)
      .single()) as { data: EnterpriseRow | null; error: unknown };

    if (entError || !enterprise) {
      return respond({ error: "Enterprise not found" }, 404);
    }

    // Server-side phrase check — never trust the client. Both inputs must match.
    const requiredPhrase = `DELETE ${enterprise.name}`;
    if (body.confirmation !== requiredPhrase || body.confirmationRepeat !== requiredPhrase) {
      return respond(
        { error: `Please type "${requiredPhrase}" in both confirmation fields.` },
        400
      );
    }

    // Precondition: block while orgs are attached.
    const attachedOrgCount = await countAttachedOrgs(ctx.serviceSupabase, ctx.enterpriseId);
    if (attachedOrgCount > 0) {
      return respond(
        {
          error: "Remove all organizations from this enterprise before deleting it.",
          attachedOrgCount,
        },
        400
      );
    }

    // Double-initiate guard: return existing pending schedule idempotently.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing, error: existingError } = (await (ctx.serviceSupabase as any)
      .from("enterprise_deletion_requests")
      .select("scheduled_deletion_at, status")
      .eq("enterprise_id", ctx.enterpriseId)
      .eq("status", "pending")
      .maybeSingle()) as { data: { scheduled_deletion_at: string } | null; error: unknown };

    if (existingError && isMissingTable(existingError)) {
      return respond(
        { error: "Enterprise deletion is not yet configured. Please contact support." },
        500
      );
    }

    if (existing) {
      return respond({
        success: true,
        scheduledDeletionAt: existing.scheduled_deletion_at,
        gracePeriodDays: GRACE_PERIOD_DAYS,
      });
    }

    const deletionDate = new Date();
    deletionDate.setDate(deletionDate.getDate() + GRACE_PERIOD_DAYS);
    const scheduledDeletionAt = deletionDate.toISOString();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upsertError } = await (ctx.serviceSupabase as any)
      .from("enterprise_deletion_requests")
      .upsert(
        {
          enterprise_id: ctx.enterpriseId,
          requested_by: ctx.userId,
          requested_at: new Date().toISOString(),
          scheduled_deletion_at: scheduledDeletionAt,
          status: "pending",
          cancelled_at: null,
          completed_at: null,
        },
        { onConflict: "enterprise_id" }
      );

    if (upsertError) {
      if (isMissingTable(upsertError)) {
        return respond(
          { error: "Enterprise deletion is not yet configured. Please contact support." },
          500
        );
      }
      throw upsertError;
    }

    const recipient = enterprise.billing_contact_email || ctx.userEmail;
    if (resend && recipient) {
      const undoLink = `${SITE_URL}/enterprise/${enterprise.slug}/settings`;
      await resend.emails.send({
        from: FROM_EMAIL,
        to: recipient,
        subject: `Enterprise Deletion Requested - ${enterprise.name}`,
        text: `
Hello,

Deletion has been requested for the enterprise "${enterprise.name}".

It and all of its data will be permanently deleted on ${formatDate(scheduledDeletionAt)}.

Billing continues normally until that date — your Stripe subscription is cancelled only when the deletion completes.

If you did not request this or wish to cancel, restore the enterprise here:
${undoLink}

This action cannot be undone after the grace period ends.
        `.trim(),
      });
    }

    logEnterpriseAuditAction({
      actorUserId: ctx.userId,
      actorEmail: ctx.userEmail,
      action: "initiate_delete",
      enterpriseId: ctx.enterpriseId,
      metadata: { scheduledDeletionAt, gracePeriodDays: GRACE_PERIOD_DAYS },
      ...extractRequestContext(req),
    });

    return respond({
      success: true,
      scheduledDeletionAt,
      gracePeriodDays: GRACE_PERIOD_DAYS,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    console.error("[enterprise/deletion] DELETE error:", error);
    return NextResponse.json({ error: "Failed to process enterprise deletion" }, { status: 500 });
  }
}

/**
 * POST /api/enterprise/[enterpriseId]/deletion
 *
 * Owner-only. Cancels (undoes) a pending deletion. Pure DB flip — no Stripe repair.
 */
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { enterpriseId } = await params;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(req, {
      userId: user?.id ?? null,
      feature: "cancel enterprise deletion",
      limitPerIp: 10,
      limitPerUser: 5,
      windowMs: 60 * 60 * 1000,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_OWNER_ROLE);
    if (!ctx.ok) return ctx.response;

    const respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pending, error: findError } = (await (ctx.serviceSupabase as any)
      .from("enterprise_deletion_requests")
      .select("id")
      .eq("enterprise_id", ctx.enterpriseId)
      .eq("status", "pending")
      .maybeSingle()) as { data: { id: string } | null; error: unknown };

    if (findError && isMissingTable(findError)) {
      return respond({ error: "No pending deletion request found" }, 404);
    }

    if (!pending) {
      return respond({ error: "No pending deletion request found" }, 404);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (ctx.serviceSupabase as any)
      .from("enterprise_deletion_requests")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", pending.id);

    if (updateError) throw updateError;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: enterprise } = (await (ctx.serviceSupabase as any)
      .from("enterprises")
      .select("name, billing_contact_email")
      .eq("id", ctx.enterpriseId)
      .single()) as { data: Pick<EnterpriseRow, "name" | "billing_contact_email"> | null };

    const recipient = enterprise?.billing_contact_email || ctx.userEmail;
    if (resend && recipient) {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: recipient,
        subject: `Enterprise Deletion Cancelled - ${enterprise?.name ?? "Enterprise"}`,
        text: `
Hello,

The deletion request for the enterprise "${enterprise?.name ?? ""}" has been cancelled. It will remain active.

If you did not cancel this request, please secure your account immediately.
        `.trim(),
      });
    }

    logEnterpriseAuditAction({
      actorUserId: ctx.userId,
      actorEmail: ctx.userEmail,
      action: "cancel_delete",
      enterpriseId: ctx.enterpriseId,
      ...extractRequestContext(req),
    });

    return respond({ success: true });
  } catch (error) {
    console.error("[enterprise/deletion] POST error:", error);
    return NextResponse.json({ error: "Failed to cancel enterprise deletion" }, { status: 500 });
  }
}

/**
 * GET /api/enterprise/[enterpriseId]/deletion
 *
 * Owner-only. Returns the deletion status plus the attached-org precondition count.
 */
export async function GET(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise deletion status",
    limitPerIp: 60,
    limitPerUser: 40,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_OWNER_ROLE);
  if (!ctx.ok) return ctx.response;

  const respond = (payload: EnterpriseDeletionStatus, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  const attachedOrgCount = await countAttachedOrgs(ctx.serviceSupabase, ctx.enterpriseId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: request, error } = (await (ctx.serviceSupabase as any)
    .from("enterprise_deletion_requests")
    .select("status, requested_at, scheduled_deletion_at")
    .eq("enterprise_id", ctx.enterpriseId)
    .maybeSingle()) as { data: DeletionRequestRow | null; error: unknown };

  if ((error && isMissingTable(error)) || !request || request.status !== "pending") {
    return respond({
      status: "none",
      requestedAt: null,
      scheduledDeletionAt: null,
      attachedOrgCount,
    });
  }

  return respond({
    status: "pending",
    requestedAt: request.requested_at,
    scheduledDeletionAt: request.scheduled_deletion_at,
    attachedOrgCount,
  });
}
