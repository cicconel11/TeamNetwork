import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  checkRateLimit,
  buildRateLimitResponse,
} from "@/lib/security/rate-limit";
import { validateJson, ValidationError, validationErrorResponse } from "@/lib/security/validation";
import { deleteAccountSchema } from "@/lib/schemas/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOUR_MS = 60 * 60 * 1000;
const GRACE_PERIOD_DAYS = 30;

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = process.env.FROM_EMAIL || "noreply@myteamnetwork.com";

// Type for the user_deletion_requests table (not in generated types yet)
interface DeletionRequest {
  id: string;
  user_id: string;
  status: "pending" | "completed" | "cancelled";
  requested_at: string;
  scheduled_deletion_at: string;
  cancelled_at: string | null;
}

/**
 * DELETE /api/user/delete-account
 *
 * Initiates account deletion with a 30-day grace period.
 * User must confirm with "DELETE MY ACCOUNT" in the request body.
 *
 * This endpoint:
 * 1. Marks the user's account for deletion (soft delete)
 * 2. Sends a confirmation email with an undo link
 * 3. Schedules actual deletion after the grace period
 *
 * GDPR/COPPA Compliance:
 * - Users can request their data be deleted
 * - Grace period allows undo if requested in error
 * - Actual deletion cascades to all user data
 *
 * NOTE: Requires `user_deletion_requests` table migration:
 * CREATE TABLE user_deletion_requests (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id),
 *   status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
 *   requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   scheduled_deletion_at TIMESTAMPTZ NOT NULL,
 *   cancelled_at TIMESTAMPTZ
 * );
 */
export async function DELETE(request: Request) {
  let respond:
    | ((payload: unknown, status?: number) => ReturnType<typeof NextResponse.json>)
    | null = null;

  try {
    const supabase = await createClient();
    const serviceSupabase = createServiceClient();

    const { data: { user } } = await supabase.auth.getUser();

    // Rate limit: 3 deletion requests per hour per user
    const rateLimit = checkRateLimit(request, {
      userId: user?.id ?? null,
      feature: "account deletion",
      limitPerIp: 5,
      limitPerUser: 3,
      windowMs: HOUR_MS,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    if (!user) {
      return respond({ error: "Unauthorized" }, 401);
    }

    // Validate confirmation
    const body = await validateJson(request, deleteAccountSchema, {
      maxBodyBytes: 1_000,
    });

    if (body.confirmation !== "DELETE MY ACCOUNT") {
      return respond(
        { error: "Please confirm deletion by typing 'DELETE MY ACCOUNT'" },
        400
      );
    }

    // Check if user is an admin of any organization
    const { data: adminOrgs } = await supabase
      .from("user_organization_roles")
      .select("organization_id, organizations(name)")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .eq("status", "active");

    if (adminOrgs && adminOrgs.length > 0) {
      const orgNames = adminOrgs
        .map((r) => {
          const org = r.organizations as { name: string } | { name: string }[] | null;
          if (Array.isArray(org)) return org[0]?.name;
          return org?.name;
        })
        .filter(Boolean)
        .join(", ");
      return respond(
        {
          error: "Cannot delete account while you are an admin of organizations",
          details: `Please transfer admin role or delete these organizations first: ${orgNames}`,
        },
        400
      );
    }

    // Calculate deletion date
    const deletionDate = new Date();
    deletionDate.setDate(deletionDate.getDate() + GRACE_PERIOD_DAYS);

    // Create or update deletion request using raw RPC to handle missing table gracefully
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upsertError } = await (serviceSupabase as any)
      .from("user_deletion_requests")
      .upsert(
        {
          user_id: user.id,
          requested_at: new Date().toISOString(),
          scheduled_deletion_at: deletionDate.toISOString(),
          status: "pending",
          cancelled_at: null,
        },
        { onConflict: "user_id" }
      );

    if (upsertError) {
      // Table might not exist yet
      if (upsertError.code === "42P01") {
        return respond(
          { error: "Account deletion feature is not yet configured. Please contact support." },
          500
        );
      }
      throw upsertError;
    }

    // Send confirmation email
    if (resend && user.email) {
      const undoLink = `${process.env.NEXT_PUBLIC_SITE_URL || "https://www.myteamnetwork.com"}/settings/account?action=cancel-deletion`;

      await resend.emails.send({
        from: FROM_EMAIL,
        to: user.email,
        subject: "Account Deletion Requested - TeamNetwork",
        text: `
Hello,

You have requested to delete your TeamNetwork account.

Your account and all associated data will be permanently deleted on ${deletionDate.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })}.

If you did not request this or wish to cancel, please visit:
${undoLink}

Or sign in to your account and navigate to Settings > Account to cancel the deletion request.

This action cannot be undone after the grace period ends.

Thank you for using TeamNetwork.
        `.trim(),
      });
    }

    // Clean up analytics data immediately (no grace period needed for anonymous data)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await Promise.allSettled([
      (serviceSupabase as any).from("analytics_consent").delete().eq("user_id", user.id),
      (serviceSupabase as any).from("usage_events").delete().eq("user_id", user.id),
      (serviceSupabase as any).from("usage_summaries").delete().eq("user_id", user.id),
      (serviceSupabase as any).from("ui_profiles").delete().eq("user_id", user.id),
    ]);

    // Sign out the user from current session (but don't delete auth record yet)
    await supabase.auth.signOut();

    return respond({
      success: true,
      message: "Account deletion scheduled",
      scheduledDeletionAt: deletionDate.toISOString(),
      gracePeriodDays: GRACE_PERIOD_DAYS,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      if (respond) {
        return respond({ error: err.message, details: err.details }, 400);
      }
      return validationErrorResponse(err);
    }

    return NextResponse.json(
      { error: "Failed to process account deletion request" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/user/delete-account
 *
 * Returns the current deletion status for the authenticated user.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const serviceSupabase = createServiceClient();

    const { data: { user } } = await supabase.auth.getUser();

    // Rate limit
    const rateLimit = checkRateLimit(request, {
      userId: user?.id ?? null,
      feature: "deletion status check",
      limitPerIp: 30,
      limitPerUser: 20,
      windowMs: 60_000,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: rateLimit.headers }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: deletionRequest, error } = await (serviceSupabase as any)
      .from("user_deletion_requests")
      .select("status, requested_at, scheduled_deletion_at")
      .eq("user_id", user.id)
      .maybeSingle() as { data: Partial<DeletionRequest> | null; error: unknown };

    // Handle missing table gracefully
    if (error && typeof error === "object" && "code" in error && error.code === "42P01") {
      return NextResponse.json(
        { status: "none", requestedAt: null, scheduledDeletionAt: null },
        { headers: rateLimit.headers }
      );
    }

    if (!deletionRequest || deletionRequest.status === "cancelled") {
      return NextResponse.json(
        {
          status: "none",
          requestedAt: null,
          scheduledDeletionAt: null,
        },
        { headers: rateLimit.headers }
      );
    }

    return NextResponse.json(
      {
        status: deletionRequest.status,
        requestedAt: deletionRequest.requested_at,
        scheduledDeletionAt: deletionRequest.scheduled_deletion_at,
      },
      { headers: rateLimit.headers }
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to check deletion status" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/user/delete-account
 *
 * Cancels a pending deletion request (undo).
 */
export async function POST(request: Request) {
  let respond:
    | ((payload: unknown, status?: number) => ReturnType<typeof NextResponse.json>)
    | null = null;

  try {
    const supabase = await createClient();
    const serviceSupabase = createServiceClient();

    const { data: { user } } = await supabase.auth.getUser();

    // Rate limit
    const rateLimit = checkRateLimit(request, {
      userId: user?.id ?? null,
      feature: "cancel deletion",
      limitPerIp: 10,
      limitPerUser: 5,
      windowMs: HOUR_MS,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    if (!user) {
      return respond({ error: "Unauthorized" }, 401);
    }

    // Check for pending deletion
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: deletionRequest, error } = await (serviceSupabase as any)
      .from("user_deletion_requests")
      .select("id, status")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .maybeSingle() as { data: Partial<DeletionRequest> | null; error: unknown };

    // Handle missing table gracefully
    if (error && typeof error === "object" && "code" in error && error.code === "42P01") {
      return respond({ error: "Account deletion feature is not yet configured" }, 404);
    }

    if (!deletionRequest) {
      return respond({ error: "No pending deletion request found" }, 404);
    }

    // Cancel the deletion
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (serviceSupabase as any)
      .from("user_deletion_requests")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
      })
      .eq("id", deletionRequest.id);

    if (updateError) {
      throw updateError;
    }

    // Send confirmation email
    if (resend && user.email) {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: user.email,
        subject: "Account Deletion Cancelled - TeamNetwork",
        text: `
Hello,

Your account deletion request has been cancelled. Your TeamNetwork account will remain active.

If you did not cancel this request, please secure your account by changing your password immediately.

Thank you for staying with TeamNetwork!
        `.trim(),
      });
    }

    return respond({
      success: true,
      message: "Account deletion cancelled",
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      if (respond) {
        return respond({ error: err.message, details: err.details }, 400);
      }
      return validationErrorResponse(err);
    }

    return NextResponse.json(
      { error: "Failed to cancel deletion request" },
      { status: 500 }
    );
  }
}
