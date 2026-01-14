/**
 * Shared helper for removing an enterprise admin.
 *
 * Used by both:
 *   - DELETE /api/enterprise/[enterpriseId]/admins (body-based)
 *   - DELETE /api/enterprise/[enterpriseId]/admins/[userId] (path-based)
 */

// Type for user_enterprise_roles table row (until types are regenerated)
interface UserEnterpriseRoleRow {
  id: string;
  role: "owner" | "billing_admin" | "org_admin";
}

export async function removeEnterpriseAdmin(
  serviceSupabase: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  enterpriseId: string,
  targetUserId: string
): Promise<{ success: true; removedRole: string } | { error: string; status: number }> {
  // Fetch the target user's role
  const { data: targetRole, error: fetchError } = await (serviceSupabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
    .from("user_enterprise_roles")
    .select("id, role")
    .eq("enterprise_id", enterpriseId)
    .eq("user_id", targetUserId)
    .single() as { data: UserEnterpriseRoleRow | null; error: Error | null };

  if (fetchError) {
    console.error("[removeEnterpriseAdmin] role fetch failed:", fetchError);
    return { error: "Internal server error", status: 500 };
  }

  if (!targetRole) {
    return { error: "User is not an admin of this enterprise", status: 404 };
  }

  // If removing an owner, ensure there's at least one other owner
  if (targetRole.role === "owner") {
    const { count: ownerCount, error: countError } = await (serviceSupabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      .from("user_enterprise_roles")
      .select("*", { count: "exact", head: true })
      .eq("enterprise_id", enterpriseId)
      .eq("role", "owner") as { count: number | null; error: Error | null };

    if (countError) {
      console.error("[removeEnterpriseAdmin] owner count failed:", countError);
      return { error: "Internal server error", status: 500 };
    }

    if ((ownerCount ?? 0) <= 1) {
      return { error: "Cannot remove the last owner. Transfer ownership first.", status: 400 };
    }
  }

  // Delete the role
  const { error: deleteError } = await (serviceSupabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
    .from("user_enterprise_roles")
    .delete()
    .eq("id", targetRole.id) as { error: Error | null };

  if (deleteError) {
    console.error("[removeEnterpriseAdmin] delete failed:", deleteError);
    return { error: "Internal server error", status: 500 };
  }

  return { success: true, removedRole: targetRole.role };
}
