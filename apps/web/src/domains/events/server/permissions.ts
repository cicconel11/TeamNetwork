export type EventPermissionResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export async function requireEventAdmin(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  orgId: string;
  actorUserId: string;
  action: "edit" | "delete";
}): Promise<EventPermissionResult> {
  const { data: membership, error: membershipError } = await input.supabase
    .from("organization_members")
    .select("role, status")
    .eq("organization_id", input.orgId)
    .eq("user_id", input.actorUserId)
    .eq("status", "active")
    .maybeSingle();

  if (membershipError) return { ok: false, status: 500, error: "Failed to verify permissions" };
  if (membership?.role !== "admin") {
    return {
      ok: false,
      status: 403,
      error: `Only admins can ${input.action} events`,
    };
  }

  return { ok: true };
}
