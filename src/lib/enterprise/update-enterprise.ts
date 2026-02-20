import type { SupabaseClient } from "@supabase/supabase-js";
import type { Enterprise } from "@/types/enterprise";
import { logEnterpriseAuditAction } from "@/lib/audit/enterprise-audit";

interface UpdateEnterprisePayload {
  name?: string;
  description?: string | null;
  logo_url?: string | null;
  primary_color?: string | null;
  billing_contact_email?: string;
}

interface UpdateEnterpriseResult {
  enterprise: Enterprise;
}

interface UpdateEnterpriseError {
  error: string;
  status: number;
}

type UpdateEnterpriseOutcome = UpdateEnterpriseResult | UpdateEnterpriseError;

export function isUpdateError(result: UpdateEnterpriseOutcome): result is UpdateEnterpriseError {
  return "error" in result;
}

/**
 * Shared enterprise update logic used by both
 * /api/enterprise/[enterpriseId]/route.ts (PATCH) and
 * /api/enterprise/[enterpriseId]/settings/route.ts (PATCH).
 *
 * Validates that there is at least one field to update, applies the update,
 * and logs the audit action.
 */
export async function updateEnterprise(
  serviceSupabase: SupabaseClient,
  enterpriseId: string,
  body: UpdateEnterprisePayload,
  actorUserId: string,
  actorEmail: string,
  auditAction: "update_enterprise" | "update_settings",
  requestContext: ReturnType<typeof import("@/lib/audit/enterprise-audit").extractRequestContext>
): Promise<UpdateEnterpriseOutcome> {
  const updatePayload: Record<string, unknown> = {};
  if (body.name !== undefined) updatePayload.name = body.name;
  if (body.description !== undefined) updatePayload.description = body.description;
  if (body.logo_url !== undefined) updatePayload.logo_url = body.logo_url;
  if (body.primary_color !== undefined) updatePayload.primary_color = body.primary_color;
  if (body.billing_contact_email !== undefined) updatePayload.billing_contact_email = body.billing_contact_email;

  if (Object.keys(updatePayload).length === 0) {
    return { error: "No valid fields to update", status: 400 };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error: updateError } = await (serviceSupabase as any)
    .from("enterprises")
    .update(updatePayload)
    .eq("id", enterpriseId)
    .select()
    .single() as { data: Enterprise | null; error: Error | null };

  if (updateError) {
    console.error("[updateEnterprise] DB error:", updateError);
    return { error: "Internal server error", status: 500 };
  }
  if (!updated) {
    return { error: "Enterprise not found", status: 404 };
  }

  logEnterpriseAuditAction({
    actorUserId,
    actorEmail,
    action: auditAction,
    enterpriseId,
    targetType: "enterprise",
    targetId: enterpriseId,
    metadata: { updatedFields: Object.keys(updatePayload) },
    ...requestContext,
  });

  return { enterprise: updated };
}
