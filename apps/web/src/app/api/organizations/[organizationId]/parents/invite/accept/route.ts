import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, baseSchemas, sanitizeIlikeInput } from "@/lib/security/validation";
import { safeString } from "@/lib/schemas";
import { claimOrgInviteUse } from "./claim-org-invite-use";

// Distinctive tag for ops to grep when a partial-state recovery is needed.
// Each occurrence carries an `id=<uuid>` correlation id that is also returned
// to the caller so support can match user reports to logs.
const ROLLBACK_ORPHAN_TAG = "[parent-invite-accept rollback orphan]";

type StepResult = { ok: true } | { ok: false; reason: string };

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

type ServiceSupabase = ReturnType<typeof createServiceClient>;

interface LegacyParentInviteRow {
  id: string;
  organization_id: string;
  status: "pending" | "accepted" | "revoked";
  expires_at: string;
}

interface OrgParentInviteRow {
  id: string;
  organization_id: string;
  role: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  uses_remaining: number | null;
}

async function lookupParentInviteByCode(
  serviceSupabase: ServiceSupabase,
  organizationId: string,
  code: string,
) {
  const lookupCode = sanitizeIlikeInput(code);
  const [legacyResult, orgResult] = await Promise.all([
    serviceSupabase
      .from("parent_invites")
      .select("id,organization_id,status,expires_at")
      .eq("organization_id", organizationId)
      .ilike("code", lookupCode)
      .maybeSingle(),
    serviceSupabase
      .from("organization_invites")
      .select("id,organization_id,role,expires_at,revoked_at,uses_remaining")
      .eq("organization_id", organizationId)
      .ilike("code", lookupCode)
      .eq("role", "parent")
      .maybeSingle(),
  ]);

  if (legacyResult.error || orgResult.error) {
    console.error("[org/parents/invite/accept] Invite lookup error:", legacyResult.error || orgResult.error);
    return { error: "Failed to process invite" as const };
  }

  const legacyInvite = (legacyResult.data as LegacyParentInviteRow | null) ?? null;
  const orgInvite = (orgResult.data as OrgParentInviteRow | null) ?? null;

  if (legacyInvite && orgInvite) {
    return { conflict: true as const };
  }

  if (orgInvite) {
    return { invite: orgInvite, source: "organization" as const };
  }

  if (legacyInvite) {
    return { invite: legacyInvite, source: "legacy" as const };
  }

  return { invite: null, source: null };
}

async function claimLegacyInvite(
  serviceSupabase: ServiceSupabase,
  invite: LegacyParentInviteRow,
  respond: (payload: unknown, status?: number) => NextResponse,
) {
  if (invite.status === "accepted") {
    return { response: respond({ error: "Invite already accepted" }, 409) };
  }

  if (invite.status === "revoked") {
    return { response: respond({ error: "Invite has been revoked" }, 410) };
  }

  const claimNow = new Date().toISOString();
  if (new Date(invite.expires_at) < new Date(claimNow)) {
    return { response: respond({ error: "Invite has expired" }, 410) };
  }

  const { data: claimedRows, error: claimError } = await serviceSupabase
    .from("parent_invites")
    .update({ status: "accepted", accepted_at: claimNow })
    .eq("id", invite.id)
    .eq("status", "pending")
    .gt("expires_at", claimNow)
    .select("id");

  if (claimError) {
    console.error("[org/parents/invite/accept] Legacy invite claim error:", claimError);
    return { response: respond({ error: "Failed to process invite" }, 500) };
  }

  if (!claimedRows || claimedRows.length === 0) {
    const { data: current } = await serviceSupabase
      .from("parent_invites")
      .select("status,expires_at")
      .eq("id", invite.id)
      .single();
    if (current?.status === "accepted") return { response: respond({ error: "Invite already accepted" }, 409) };
    if (current?.status === "revoked") return { response: respond({ error: "Invite has been revoked" }, 410) };
    return { response: respond({ error: "Invite has expired" }, 410) };
  }

  return {
    organizationId: invite.organization_id,
    rollback: async () => {
      await serviceSupabase
        .from("parent_invites")
        .update({ status: "pending", accepted_at: null })
        .eq("id", invite.id)
        .eq("status", "accepted");
    },
  };
}

// Outcome of grantParentMembership tells the caller exactly what happened so a
// later failure can undo the *correct* state — either deleting a freshly
// inserted row, or restoring a previously-revoked row to its original role +
// status. The previous implementation rolled back by unconditionally deleting
// the row, which destroyed history when the row had been reactivated.
type MembershipOutcome =
  | { kind: "inserted" }
  | { kind: "reactivated"; previousRole: string };

async function grantParentMembership(
  serviceSupabase: ServiceSupabase,
  userId: string,
  organizationId: string,
  respond: (payload: unknown, status?: number) => NextResponse,
): Promise<
  | { ok: true; outcome: MembershipOutcome; undo: () => Promise<StepResult> }
  | { ok: false; response: NextResponse }
> {
  const { error: roleError } = await serviceSupabase
    .from("user_organization_roles")
    .insert({
      user_id: userId,
      organization_id: organizationId,
      role: "parent",
      status: "active",
    });

  if (!roleError) {
    return {
      ok: true,
      outcome: { kind: "inserted" },
      undo: async () => {
        const { error: deleteError } = await serviceSupabase
          .from("user_organization_roles")
          .delete()
          .eq("user_id", userId)
          .eq("organization_id", organizationId)
          .eq("role", "parent")
          .eq("status", "active");
        if (deleteError) {
          return { ok: false, reason: `delete inserted role failed: ${deleteError.message}` };
        }
        return { ok: true };
      },
    };
  }

  if (roleError.code === "23505") {
    // Read the existing row so we know what to restore on rollback. Filter on
    // status='revoked' because reactivating an already-active row would
    // overwrite a real membership.
    const { data: existing, error: existingError } = await serviceSupabase
      .from("user_organization_roles")
      .select("role,status")
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .eq("status", "revoked")
      .maybeSingle();

    if (existingError) {
      console.error("[org/parents/invite/accept] Role lookup before reactivate error:", existingError);
      return { ok: false, response: respond({ error: "Failed to reactivate membership" }, 500) };
    }

    if (!existing) {
      // Active row already exists for this (user, org). The route should not
      // change anything; treat this as a successful "no-op" grant since the
      // user is already a member, and provide a no-op undo.
      return {
        ok: true,
        outcome: { kind: "reactivated", previousRole: "" },
        undo: async () => ({ ok: true }),
      };
    }

    const previousRole = existing.role;

    const { error: reactivateError } = await serviceSupabase
      .from("user_organization_roles")
      .update({ status: "active", role: "parent" })
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .eq("status", "revoked");

    if (reactivateError) {
      console.error("[org/parents/invite/accept] Role reactivation error:", reactivateError);
      return { ok: false, response: respond({ error: "Failed to reactivate membership" }, 500) };
    }

    return {
      ok: true,
      outcome: { kind: "reactivated", previousRole },
      undo: async () => {
        const { error: restoreError } = await serviceSupabase
          .from("user_organization_roles")
          .update({ status: "revoked", role: previousRole })
          .eq("user_id", userId)
          .eq("organization_id", organizationId)
          .eq("status", "active")
          .eq("role", "parent");
        if (restoreError) {
          return { ok: false, reason: `restore revoked role failed: ${restoreError.message}` };
        }
        return { ok: true };
      },
    };
  }

  console.error("[org/parents/invite/accept] Role insert error:", roleError);
  return { ok: false, response: respond({ error: "Failed to create membership" }, 500) };
}

async function findParentId(
  serviceSupabase: ServiceSupabase,
  organizationId: string,
  userId: string,
  email: string,
  respond: (payload: unknown, status?: number) => NextResponse,
) {
  const { data: parentByUser, error: userLookupError } = await serviceSupabase
    .from("parents")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (userLookupError) {
    console.error("[org/parents/invite/accept] Parent lookup by user error:", userLookupError);
    return { response: respond({ error: "Failed to create parent record" }, 500) };
  }

  if (parentByUser?.id) {
    return { parentId: parentByUser.id };
  }

  const { data: parentByEmail, error: emailLookupError } = await serviceSupabase
    .from("parents")
    .select("id")
    .eq("organization_id", organizationId)
    .ilike("email", sanitizeIlikeInput(email))
    .is("deleted_at", null)
    .maybeSingle();

  if (emailLookupError) {
    console.error("[org/parents/invite/accept] Parent lookup by email error:", emailLookupError);
    return { response: respond({ error: "Failed to create parent record" }, 500) };
  }

  if (parentByEmail?.id) {
    return { parentId: parentByEmail.id };
  }

  return { response: respond({ error: "Failed to create parent record" }, 500) };
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
  const lookupResult = await lookupParentInviteByCode(serviceSupabase, organizationId, code);
  if ("error" in lookupResult) {
    return respond({ error: lookupResult.error }, 500);
  }
  if ("conflict" in lookupResult) {
    return respond(
      { error: "Invite code conflict. Please ask your administrator for a new parent invite link." },
      409
    );
  }
  if (!lookupResult.invite || !lookupResult.source) {
    return respond({ error: "Invalid invite code" }, 400);
  }

  if (lookupResult.invite.organization_id !== organizationId) {
    return respond({ error: "Invalid invite code" }, 400);
  }

  const claimResult = lookupResult.source === "legacy"
    ? await claimLegacyInvite(serviceSupabase, lookupResult.invite, respond)
    : await claimOrgInviteUse(serviceSupabase, lookupResult.invite.id, respond);

  if ("response" in claimResult) {
    return claimResult.response;
  }

  // Create or look up auth user using the email supplied by the parent at redemption time
  let userId: string;

  const { data: createResult, error: createError } = await serviceSupabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      first_name,
      last_name,
      full_name: `${first_name} ${last_name}`.trim(),
    },
  });

  if (createError) {
    const isEmailExists =
      (createError as { status?: number }).status === 422 ||
      createError.code === "email_exists" ||
      createError.code === "user_already_exists";
    if (isEmailExists) {
      await claimResult.rollback();
      // Reject rather than silently granting org membership to an email the caller may not own.
      // An existing user must sign in and accept the invite via an authenticated endpoint.
      return respond(
        { error: "This email is already registered. Please sign in to accept this invite." },
        409
      );
    }
    await claimResult.rollback();
    console.error("[org/parents/invite/accept] Auth user creation error:", createError);
    return respond({ error: "Failed to create user account. Please try again." }, 500);
  } else {
    userId = createResult.user.id;
  }

  // Run a list of rollback steps in order. Every step is awaited even if an
  // earlier one fails — the goal is to walk back as much partial state as
  // possible. The boolean return indicates whether *every* step succeeded;
  // failures are logged with the correlation id so ops can finish recovery.
  const runRollback = async (
    correlationId: string,
    steps: Array<{ name: string; run: () => Promise<StepResult> }>,
  ): Promise<{ ok: boolean; failed: string[] }> => {
    const failed: string[] = [];
    for (const step of steps) {
      try {
        const result = await step.run();
        if (!result.ok) {
          failed.push(`${step.name}: ${result.reason}`);
          console.error(
            `${ROLLBACK_ORPHAN_TAG} id=${correlationId} step=${step.name} reason=${result.reason}`,
          );
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        failed.push(`${step.name}: ${reason}`);
        console.error(
          `${ROLLBACK_ORPHAN_TAG} id=${correlationId} step=${step.name} threw=${reason}`,
        );
      }
    }
    return { ok: failed.length === 0, failed };
  };

  // Wrap the existing claim/auth-delete callbacks in the StepResult shape.
  const inviteRollbackStep = {
    name: "invite",
    run: async (): Promise<StepResult> => {
      try {
        await claimResult.rollback();
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const authUserDeleteStep = {
    name: "auth-user",
    run: async (): Promise<StepResult> => {
      try {
        const { error: deleteError } = await serviceSupabase.auth.admin.deleteUser(userId);
        if (deleteError) {
          return { ok: false, reason: deleteError.message };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const membershipResult = await grantParentMembership(
    serviceSupabase,
    userId,
    claimResult.organizationId,
    respond,
  );
  if (!membershipResult.ok) {
    // No membership was created, so only invite + auth user need undoing.
    const correlationId = randomUUID();
    const rollback = await runRollback(correlationId, [inviteRollbackStep, authUserDeleteStep]);

    if (!rollback.ok) {
      // Auth-user delete (or invite restore) failed. Restoring the invite to
      // pending while a stranded auth user shares the email would lock the
      // parent out on the next attempt (email_exists → invite re-rolled back
      // again → permanent loop). Surface a stable id so support can clean up.
      return respond(
        {
          error:
            "Failed to create membership and partial cleanup did not complete. Please contact support with this id.",
          recoveryId: correlationId,
        },
        500,
      );
    }
    return membershipResult.response;
  }

  const parentResult = await findParentId(
    serviceSupabase,
    claimResult.organizationId,
    userId,
    email,
    respond,
  );
  if ("response" in parentResult) {
    // Three things need undoing now: the membership row (using the
    // outcome-aware undo so reactivated rows get restored, not deleted),
    // the invite claim, and the auth user. Order matters only weakly here —
    // we run them all and report any failures via the correlation id.
    const correlationId = randomUUID();
    const rollback = await runRollback(correlationId, [
      {
        name: "membership",
        run: () => membershipResult.undo(),
      },
      inviteRollbackStep,
      authUserDeleteStep,
    ]);

    if (!rollback.ok) {
      return respond(
        {
          error:
            "Failed to create parent record and partial cleanup did not complete. Please contact support with this id.",
          recoveryId: correlationId,
        },
        500,
      );
    }
    return parentResult.response;
  }

  const parentId = parentResult.parentId;
  return respond({ success: true, parentId });
}
