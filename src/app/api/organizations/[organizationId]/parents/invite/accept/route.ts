import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, baseSchemas, sanitizeIlikeInput } from "@/lib/security/validation";
import { safeString } from "@/lib/schemas";

const acceptInviteSchema = z.object({
  code: z.string().min(1).max(200),
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

  const { code, first_name, last_name, password } = body;
  const serviceSupabase = createServiceClient();

  // Look up invite by code using service client (bypasses RLS)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invite, error: inviteError } = await (serviceSupabase as any)
    .from("parent_invites")
    .select("id,organization_id,email,status,expires_at")
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

  // Create or look up auth user
  let userId: string;

  const { data: createResult, error: createError } = await serviceSupabase.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true,
  });

  if (createError) {
    // AuthApiError status 422 indicates the email is already registered
    const isEmailExists =
      (createError as { status?: number }).status === 422 ||
      createError.code === "email_exists" ||
      createError.code === "user_already_exists";
    if (isEmailExists) {
      // Look up user by email via auth schema (exact match — auth emails are lowercase)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existingUsers } = await (serviceSupabase as any)
        .schema("auth")
        .from("users")
        .select("id")
        .eq("email", invite.email.toLowerCase())
        .maybeSingle();

      if (!existingUsers?.id) {
        console.error("[org/parents/invite/accept] Could not find existing user:", invite.email);
        return respond({ error: "Failed to create user account" }, 500);
      }
      userId = existingUsers.id;
    } else {
      console.error("[org/parents/invite/accept] Auth user creation error:", createError);
      return respond({ error: "Failed to create user account" }, 500);
    }
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
    .ilike("email", sanitizeIlikeInput(invite.email))
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
        email: invite.email,
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

  // Mark invite as accepted
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateError } = await (serviceSupabase as any)
    .from("parent_invites")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  if (updateError) {
    // Non-fatal: parent record already created; log but don't fail
    console.error("[org/parents/invite/accept] Invite update error:", updateError);
  }

  return respond({ success: true, parentId });
}
