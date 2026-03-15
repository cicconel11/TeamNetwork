import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, baseSchemas, sanitizeIlikeInput } from "@/lib/security/validation";
import { safeString } from "@/lib/schemas";

const acceptInviteSchema = z.object({
  code: z.string().min(1).max(200),
  email: z.string().trim().email().max(320).transform(v => v.toLowerCase()),
  first_name: safeString(100),
  last_name: safeString(100),
  password: z.string().min(8).max(128),
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  // organizationId is available if needed for future validation
  params: Promise<{ organizationId: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;

  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  // Rate limit by IP only (unauthenticated endpoint)
  const rateLimit = checkRateLimit(req, {
    userId: null,
    feature: "org parents invite accept",
    limitPerIp: 30,
    limitPerUser: 0,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  let body;
  try {
    body = await validateJson(req, acceptInviteSchema, { maxBodyBytes: 8_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return respond({ error: error.message, details: error.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  const { code, email, first_name, last_name, password } = body;
  const serviceSupabase = createServiceClient();

  // Look up invite by code using service client (bypasses RLS)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invite, error: inviteError } = await (serviceSupabase as any)
    .from("parent_invites")
    .select("id,organization_id,status,expires_at")
    .eq("code", code)
    .maybeSingle();

  if (inviteError || !invite) {
    return respond({ error: "Invalid invite code" }, 400);
  }

  // Validate invite is for the right org
  if (invite.organization_id !== organizationId) {
    return respond({ error: "Invalid invite code" }, 400);
  }

  if (invite.status === "accepted") {
    return respond({ error: "Invite already accepted" }, 409);
  }

  if (invite.status === "revoked") {
    return respond({ error: "Invite has been revoked" }, 410);
  }

  if (new Date(invite.expires_at) < new Date()) {
    return respond({ error: "Invite has expired" }, 410);
  }

  // Atomically claim the invite before any state mutations (TOCTOU protection).
  // If two concurrent requests both read status='pending' and pass the checks above,
  // this UPDATE WHERE status='pending' AND expires_at > now() ensures only one proceeds:
  // the other gets 0 rows back and returns the right status via re-fetch below.
  // The expiry guard is included here so a race between the read and the claim cannot
  // result in an expired invite being accepted.
  const claimNow = new Date().toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: claimedRows, error: claimError } = await (serviceSupabase as any)
    .from("parent_invites")
    .update({ status: "accepted", accepted_at: claimNow })
    .eq("id", invite.id)
    .eq("status", "pending")
    .gt("expires_at", claimNow)
    .select("id");

  if (claimError) {
    console.error("[org/parents/invite/accept] Invite claim error:", claimError);
    return respond({ error: "Failed to process invite" }, 500);
  }

  if (!claimedRows || claimedRows.length === 0) {
    // Re-fetch to return an accurate status code (expired vs. already accepted vs. revoked)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: current } = await (serviceSupabase as any)
      .from("parent_invites")
      .select("status,expires_at")
      .eq("id", invite.id)
      .single();
    if (current?.status === "accepted") return respond({ error: "Invite already accepted" }, 409);
    if (current?.status === "revoked")  return respond({ error: "Invite has been revoked" }, 410);
    return respond({ error: "Invite has expired" }, 410);
  }

  // Create or look up auth user using the email supplied by the parent at redemption time
  let userId: string;

  const { data: createResult, error: createError } = await serviceSupabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError) {
    const isEmailExists =
      (createError as { status?: number }).status === 422 ||
      createError.code === "email_exists" ||
      createError.code === "user_already_exists";
    if (isEmailExists) {
      // Reject rather than silently granting org membership to an email the caller may not own.
      // An existing user must sign in and accept the invite via an authenticated endpoint.
      return respond(
        { error: "This email is already registered. Please sign in to accept this invite." },
        409
      );
    }
    // Transient/unexpected error — roll back the invite claim so the parent can retry.
    // Best-effort: if the rollback itself fails we still return 500 (no nested error handling).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (serviceSupabase as any)
      .from("parent_invites")
      .update({ status: "pending", accepted_at: null })
      .eq("id", invite.id)
      .eq("status", "accepted");
    console.error("[org/parents/invite/accept] Auth user creation error:", createError);
    return respond({ error: "Failed to create user account. Please try again." }, 500);
  } else {
    userId = createResult.user.id;
  }

  // Upsert parent record: reuse existing non-deleted record for this org+email if present.
  // This prevents duplicate rows when an admin manually added the parent before sending the invite.
  // Preserves admin-set fields (relationship, student_name, notes, etc.) on the existing record.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingParent } = await (serviceSupabase as any)
    .from("parents")
    .select("id")
    .eq("organization_id", invite.organization_id)
    .ilike("email", sanitizeIlikeInput(email))
    .is("deleted_at", null)
    .maybeSingle();

  let parentId: string;

  if (existingParent) {
    // Link the existing record to the auth user; update name from the acceptance form.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: linkError } = await (serviceSupabase as any)
      .from("parents")
      .update({ user_id: userId, first_name, last_name, updated_at: new Date().toISOString() })
      .eq("id", existingParent.id);

    if (linkError) {
      console.error("[org/parents/invite/accept] Parent link error:", linkError);
      return respond({ error: "Failed to link parent record" }, 500);
    }
    parentId = existingParent.id;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: parent, error: parentError } = await (serviceSupabase as any)
      .from("parents")
      .insert({
        organization_id: invite.organization_id,
        user_id: userId,
        first_name,
        last_name,
        email,
      })
      .select("id")
      .single();

    if (parentError || !parent) {
      console.error("[org/parents/invite/accept] Parent insert error:", parentError);
      return respond({ error: "Failed to create parent record" }, 500);
    }
    parentId = parent.id;
  }

  // Grant org membership — service client bypasses RLS (safe; invite already validated)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: roleError } = await (serviceSupabase as any)
    .from("user_organization_roles")
    .insert({
      user_id: userId,
      organization_id: invite.organization_id,
      role: "parent",
      status: "active",
    });

  if (roleError) {
    if (roleError.code === "23505") {
      // User already has an org membership row (could be active or revoked).
      // Only reactivate revoked memberships; leave active memberships untouched.
      // Consistent with redeem_org_invite which returns already_member=true for active users.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: reactivateError } = await (serviceSupabase as any)
        .from("user_organization_roles")
        .update({ status: "active", role: "parent" })
        .eq("user_id", userId)
        .eq("organization_id", invite.organization_id)
        .eq("status", "revoked");

      if (reactivateError) {
        console.error("[org/parents/invite/accept] Role reactivation error:", reactivateError);
        return respond({ error: "Failed to reactivate membership" }, 500);
      }
    } else {
      console.error("[org/parents/invite/accept] Role insert error:", roleError);
      return respond({ error: "Failed to create membership" }, 500);
    }
  }

  return respond({ success: true, parentId });
}
