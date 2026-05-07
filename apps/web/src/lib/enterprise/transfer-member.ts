/**
 * Member move/copy between enterprise sub-organizations.
 *
 * Move = INSERT into target org + DELETE from source org (hard delete).
 * Copy = INSERT into target org only.
 *
 * Order matters: INSERT first, DELETE second.
 * If INSERT fails, the source membership is untouched.
 *
 * user_organization_roles has NO deleted_at column, so moves use hard DELETE.
 */

import type { EnterpriseRole } from "@/types/enterprise";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

export interface TransferMemberParams {
  serviceSupabase: SupabaseClient;
  enterpriseId: string;
  userId: string;
  sourceOrgId: string;
  targetOrgId: string;
  action: "move" | "copy";
  targetRole?: string;
}

export type TransferResult =
  | { ok: true; action: "move" | "copy" }
  | { ok: false; error: string };

interface TransferValidationRequest {
  userId: string;
  sourceOrgId: string;
  action: "move" | "copy";
}

interface TransferValidationContext {
  sourceOrgNamesById: Map<string, string>;
  sourceMembershipsByKey: Map<string, { role: string; status: string | null }>;
  activeAdminCountsByOrgId: Map<string, number>;
  manageableSourceOrgIds?: Set<string>;
}

interface ValidateTransferRequestsParams {
  serviceSupabase: SupabaseClient;
  enterpriseId: string;
  transfers: TransferValidationRequest[];
  actorUserId?: string;
  actorRole?: EnterpriseRole;
}

export type TransferValidationResult =
  | { ok: true }
  | { ok: false; status: number; error: string; details?: string[] };

function transferKey(userId: string, sourceOrgId: string) {
  return `${userId}:${sourceOrgId}`;
}

export function evaluateTransferPreflight(
  transfers: TransferValidationRequest[],
  context: TransferValidationContext,
  actorRole?: EnterpriseRole
): TransferValidationResult {
  const movingAdminCounts = new Map<string, number>();

  for (const transfer of transfers) {
    if (!transfer.sourceOrgId.trim()) {
      return {
        ok: false,
        status: 400,
        error: `Select a source organization for member ${transfer.userId} before continuing.`,
      };
    }

    if (!context.sourceOrgNamesById.has(transfer.sourceOrgId)) {
      return {
        ok: false,
        status: 400,
        error: "Source organization does not belong to this enterprise",
      };
    }

    if (
      actorRole === "org_admin" &&
      context.manageableSourceOrgIds &&
      !context.manageableSourceOrgIds.has(transfer.sourceOrgId)
    ) {
      return {
        ok: false,
        status: 403,
        error: `You can only transfer members from organizations you actively administer.`,
      };
    }

    const sourceMembership = context.sourceMembershipsByKey.get(
      transferKey(transfer.userId, transfer.sourceOrgId)
    );

    if (!sourceMembership) {
      return {
        ok: false,
        status: 400,
        error: `Member ${transfer.userId} does not have a role in the selected source organization.`,
      };
    }

    if (sourceMembership.status !== "active") {
      return {
        ok: false,
        status: 400,
        error: `Member ${transfer.userId} is not active in the selected source organization.`,
      };
    }

    if (transfer.action === "move" && sourceMembership.role === "admin") {
      movingAdminCounts.set(
        transfer.sourceOrgId,
        (movingAdminCounts.get(transfer.sourceOrgId) ?? 0) + 1
      );
    }
  }

  for (const [sourceOrgId, movingAdminCount] of movingAdminCounts.entries()) {
    const activeAdminCount = context.activeAdminCountsByOrgId.get(sourceOrgId) ?? 0;
    if (activeAdminCount - movingAdminCount < 1) {
      const sourceOrgName = context.sourceOrgNamesById.get(sourceOrgId) ?? "the source organization";
      return {
        ok: false,
        status: 400,
        error: `Cannot move all admins out of ${sourceOrgName}.`,
      };
    }
  }

  return { ok: true };
}

export async function validateTransferRequests({
  serviceSupabase,
  enterpriseId,
  transfers,
  actorUserId,
  actorRole,
}: ValidateTransferRequestsParams): Promise<TransferValidationResult> {
  if (transfers.length === 0) {
    return { ok: true };
  }

  const missingSourceOrgTransfer = transfers.find(
    (transfer) => !transfer.sourceOrgId.trim()
  );

  if (missingSourceOrgTransfer) {
    return {
      ok: false,
      status: 400,
      error: `Select a source organization for member ${missingSourceOrgTransfer.userId} before continuing.`,
    };
  }

  const sourceOrgIds = Array.from(new Set(transfers.map((transfer) => transfer.sourceOrgId)));
  const userIds = Array.from(new Set(transfers.map((transfer) => transfer.userId)));
  const moveSourceOrgIds = Array.from(
    new Set(
      transfers
        .filter((transfer) => transfer.action === "move")
        .map((transfer) => transfer.sourceOrgId)
    )
  );

  const [
    { data: sourceOrgs, error: sourceOrgsError },
    { data: sourceMemberships, error: sourceMembershipsError },
    adminCountsResult,
    manageableOrgsResult,
  ] = await Promise.all([
    serviceSupabase
      .from("organizations")
      .select("id, name")
      .in("id", sourceOrgIds)
      .eq("enterprise_id", enterpriseId),
    serviceSupabase
      .from("user_organization_roles")
      .select("user_id, organization_id, role, status")
      .in("user_id", userIds)
      .in("organization_id", sourceOrgIds),
    moveSourceOrgIds.length > 0
      ? serviceSupabase
          .from("user_organization_roles")
          .select("user_id, organization_id")
          .in("organization_id", moveSourceOrgIds)
          .eq("role", "admin")
          .eq("status", "active")
      : Promise.resolve({ data: [], error: null }),
    actorRole === "org_admin" && actorUserId
      ? serviceSupabase
          .from("user_organization_roles")
          .select("organization_id, organizations!inner(enterprise_id)")
          .eq("user_id", actorUserId)
          .eq("role", "admin")
          .eq("status", "active")
          .eq("organizations.enterprise_id", enterpriseId)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (sourceOrgsError || sourceMembershipsError || adminCountsResult.error || manageableOrgsResult.error) {
    console.error("[transfer-member] preflight query failed", {
      sourceOrgsError,
      sourceMembershipsError,
      adminCountsError: adminCountsResult.error,
      manageableOrgsError: manageableOrgsResult.error,
    });
    return {
      ok: false,
      status: 503,
      error: "Unable to validate member transfers right now.",
    };
  }

  const sourceOrgNamesById = new Map(
    ((sourceOrgs ?? []) as Array<{ id: string; name: string }>).map((sourceOrg) => [
      sourceOrg.id,
      sourceOrg.name,
    ])
  );

  const sourceMembershipsByKey = new Map(
    (
      (sourceMemberships ?? []) as Array<{
        user_id: string;
        organization_id: string;
        role: string;
        status: string | null;
      }>
    ).map((membership) => [
      transferKey(membership.user_id, membership.organization_id),
      {
        role: membership.role,
        status: membership.status,
      },
    ])
  );

  const activeAdminCountsByOrgId = new Map<string, number>();
  for (const adminMembership of (adminCountsResult.data ?? []) as Array<{ organization_id: string }>) {
    activeAdminCountsByOrgId.set(
      adminMembership.organization_id,
      (activeAdminCountsByOrgId.get(adminMembership.organization_id) ?? 0) + 1
    );
  }

  const manageableSourceOrgIds =
    actorRole === "org_admin"
      ? new Set(
          (
            (manageableOrgsResult.data ?? []) as Array<{
              organization_id: string;
            }>
          ).map((membership) => membership.organization_id)
        )
      : undefined;

  return evaluateTransferPreflight(
    transfers,
    {
      sourceOrgNamesById,
      sourceMembershipsByKey,
      activeAdminCountsByOrgId,
      manageableSourceOrgIds,
    },
    actorRole
  );
}

/**
 * Transfer a member between orgs within an enterprise.
 * Idempotent: skips if user already has an active role in the target org.
 */
export async function transferMemberRole(
  params: TransferMemberParams
): Promise<TransferResult> {
  const {
    serviceSupabase,
    enterpriseId,
    userId,
    sourceOrgId,
    targetOrgId,
    action,
    targetRole = "active_member",
  } = params;

  if (sourceOrgId === targetOrgId) {
    return { ok: true, action };
  }

  const sourceValidation = await validateTransferRequests({
    serviceSupabase,
    enterpriseId,
    transfers: [{ userId, sourceOrgId, action }],
  });

  if (!sourceValidation.ok) {
    return { ok: false, error: sourceValidation.error };
  }

  // Verify target org belongs to this enterprise
  const { data: targetOrg } = await serviceSupabase
    .from("organizations")
    .select("id")
    .eq("id", targetOrgId)
    .eq("enterprise_id", enterpriseId)
    .maybeSingle();

  if (!targetOrg) {
    return { ok: false, error: "Target organization does not belong to this enterprise" };
  }

  // Check if user already has a role in target org
  const { data: existingRole } = await serviceSupabase
    .from("user_organization_roles")
    .select("id, role, status")
    .eq("user_id", userId)
    .eq("organization_id", targetOrgId)
    .maybeSingle();

  if (existingRole?.status === "active") {
    if (action !== "move") {
      return { ok: true, action };
    }
  } else if (existingRole) {
    const { error: updateError } = await serviceSupabase
      .from("user_organization_roles")
      .update({
        role: targetRole,
        status: "active",
      })
      .eq("id", existingRole.id);

    if (updateError) {
      return {
        ok: false,
        error: `Failed to reactivate member in target org: ${updateError.message}`,
      };
    }
  } else {
    // Step 1: INSERT into target org
    const { error: insertError } = await serviceSupabase
      .from("user_organization_roles")
      .insert({
        user_id: userId,
        organization_id: targetOrgId,
        role: targetRole,
        status: "active",
      });

    if (insertError) {
      // Unique violation means they're already there (race condition — treat as success)
      if (insertError.code !== "23505") {
        return {
          ok: false,
          error: `Failed to add member to target org: ${insertError.message}`,
        };
      }
    }
  }

  // Step 2: DELETE from source org (move only)
  if (action === "move") {
    const { error: deleteError } = await serviceSupabase
      .from("user_organization_roles")
      .delete()
      .eq("user_id", userId)
      .eq("organization_id", sourceOrgId);

    if (deleteError) {
      // Non-fatal: member is now in both orgs (copy-like state)
      console.error(
        `[transfer-member] DELETE from source failed for user ${userId}, org ${sourceOrgId}:`,
        deleteError
      );
      return {
        ok: false,
        error: `Member added to target but could not be removed from source: ${deleteError.message}`,
      };
    }
  }

  return { ok: true, action };
}
