import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

type ServiceSupabase = ReturnType<typeof createServiceClient>;

const MAX_LIMITED_USE_CLAIM_ATTEMPTS = 5;
const INVITE_REDEMPTION_CONTENTION_ERROR = "Invite is currently being redeemed. Please try again.";

export async function claimOrgInviteUse(
  serviceSupabase: ServiceSupabase,
  inviteId: string,
  respond: (payload: unknown, status?: number) => NextResponse,
) {
  for (let attempt = 0; attempt < MAX_LIMITED_USE_CLAIM_ATTEMPTS; attempt += 1) {
    const { data: current, error: currentError } = await serviceSupabase
      .from("organization_invites")
      .select("id,organization_id,role,expires_at,revoked_at,uses_remaining")
      .eq("id", inviteId)
      .eq("role", "parent")
      .maybeSingle();

    if (currentError || !current) {
      if (currentError) {
        console.error("[org/parents/invite/accept] Org invite reload error:", currentError);
        return { response: respond({ error: "Failed to process invite" }, 500) };
      }
      return { response: respond({ error: "Invalid invite code" }, 400) };
    }

    const now = new Date();
    if (current.organization_id == null) {
      return { response: respond({ error: "Invalid invite code" }, 400) };
    }
    if (current.revoked_at) {
      return { response: respond({ error: "Invite has been revoked" }, 410) };
    }
    if (current.expires_at && new Date(current.expires_at) < now) {
      return { response: respond({ error: "Invite has expired" }, 410) };
    }
    if (current.uses_remaining == null) {
      return {
        organizationId: current.organization_id,
        rollback: async () => {},
      };
    }
    if (current.uses_remaining <= 0) {
      return { response: respond({ error: "Invite has no uses remaining" }, 409) };
    }

    const claimNow = new Date().toISOString();
    const nextUsesRemaining = current.uses_remaining - 1;
    let claimQuery = serviceSupabase
      .from("organization_invites")
      .update({ uses_remaining: nextUsesRemaining })
      .eq("id", current.id)
      .eq("role", "parent")
      .eq("uses_remaining", current.uses_remaining)
      .is("revoked_at", null);

    if (current.expires_at !== null) {
      claimQuery = claimQuery.gt("expires_at", claimNow);
    }

    const { data: claimedRows, error: claimError } = await claimQuery.select("id");

    if (claimError) {
      console.error("[org/parents/invite/accept] Org invite claim error:", claimError);
      return { response: respond({ error: "Failed to process invite" }, 500) };
    }

    if (claimedRows && claimedRows.length > 0) {
      let rolledBack = false;

      return {
        organizationId: current.organization_id,
        rollback: async () => {
          if (rolledBack) {
            return;
          }

          for (let rollbackAttempt = 0; rollbackAttempt < MAX_LIMITED_USE_CLAIM_ATTEMPTS; rollbackAttempt += 1) {
            const { data: rollbackCurrent, error: rollbackCurrentError } = await serviceSupabase
              .from("organization_invites")
              .select("id,role,uses_remaining")
              .eq("id", current.id)
              .eq("role", "parent")
              .maybeSingle();

            if (rollbackCurrentError || !rollbackCurrent || rollbackCurrent.uses_remaining == null) {
              return;
            }

            const { data: restoredRows, error: restoreError } = await serviceSupabase
              .from("organization_invites")
              .update({ uses_remaining: rollbackCurrent.uses_remaining + 1 })
              .eq("id", current.id)
              .eq("role", "parent")
              .eq("uses_remaining", rollbackCurrent.uses_remaining)
              .select("id");

            if (restoreError) {
              console.error("[org/parents/invite/accept] Org invite rollback error:", restoreError);
              return;
            }

            if (restoredRows && restoredRows.length > 0) {
              rolledBack = true;
              return;
            }
          }
        },
      };
    }
  }

  const { data: current, error: currentError } = await serviceSupabase
    .from("organization_invites")
    .select("organization_id,expires_at,revoked_at,uses_remaining")
    .eq("id", inviteId)
    .eq("role", "parent")
    .maybeSingle();

  if (currentError) {
    console.error("[org/parents/invite/accept] Org invite final reload error:", currentError);
    return { response: respond({ error: "Failed to process invite" }, 500) };
  }
  if (!current || current.organization_id == null) {
    return { response: respond({ error: "Invalid invite code" }, 400) };
  }
  if (current.revoked_at) {
    return { response: respond({ error: "Invite has been revoked" }, 410) };
  }
  if (current.expires_at && new Date(current.expires_at) < new Date()) {
    return { response: respond({ error: "Invite has expired" }, 410) };
  }
  if (current.uses_remaining == null) {
    return {
      organizationId: current.organization_id,
      rollback: async () => {},
    };
  }
  if (current.uses_remaining <= 0) {
    return { response: respond({ error: "Invite has no uses remaining" }, 409) };
  }

  return { response: respond({ error: INVITE_REDEMPTION_CONTENTION_ERROR }, 409) };
}
