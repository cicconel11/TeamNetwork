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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

export interface TransferMemberParams {
  serviceSupabase: SupabaseClient;
  userId: string;
  sourceOrgId: string;
  targetOrgId: string;
  action: "move" | "copy";
  targetRole?: string;
}

export type TransferResult =
  | { ok: true; action: "move" | "copy" }
  | { ok: false; error: string };

/**
 * Transfer a member between orgs within an enterprise.
 * Idempotent: skips if user already has an active role in the target org.
 */
export async function transferMemberRole(
  params: TransferMemberParams
): Promise<TransferResult> {
  const {
    serviceSupabase,
    userId,
    sourceOrgId,
    targetOrgId,
    action,
    targetRole = "active_member",
  } = params;

  // Check if user already has a role in target org
  const { data: existingRole } = await serviceSupabase
    .from("user_organization_roles")
    .select("id, role")
    .eq("user_id", userId)
    .eq("organization_id", targetOrgId)
    .maybeSingle();

  if (existingRole) {
    // Already in target org — nothing to do
    return { ok: true, action };
  }

  // For moves, check sole-admin guard
  if (action === "move") {
    const { data: sourceRole } = await serviceSupabase
      .from("user_organization_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("organization_id", sourceOrgId)
      .maybeSingle();

    if (sourceRole?.role === "admin") {
      // Count other admins in source org
      const { count: adminCount } = await serviceSupabase
        .from("user_organization_roles")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", sourceOrgId)
        .eq("role", "admin")
        .neq("user_id", userId);

      if ((adminCount ?? 0) === 0) {
        return {
          ok: false,
          error: `Cannot move the sole admin out of the source organization`,
        };
      }
    }
  }

  // Step 1: INSERT into target org
  const { error: insertError } = await serviceSupabase
    .from("user_organization_roles")
    .insert({
      user_id: userId,
      organization_id: targetOrgId,
      role: targetRole,
    });

  if (insertError) {
    // Unique violation means they're already there (race condition — treat as success)
    if (insertError.code === "23505") {
      return { ok: true, action };
    }
    return {
      ok: false,
      error: `Failed to add member to target org: ${insertError.message}`,
    };
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
