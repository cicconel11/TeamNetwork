import { createServiceClient } from "@/lib/supabase/service";
import { checkAdoptionQuota, canEnterpriseAddSubOrg } from "./quota";

const ADOPTION_EXPIRY_DAYS = 7;

/**
 * Compensating rollback: clear enterprise_id on org.
 * Retries once on failure since a transient error leaving the org
 * orphaned is worse than a slight delay.
 */
async function rollbackOrgEnterprise(
  supabase: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  orgId: string
): Promise<void> {
  const rollbackPayload = {
    enterprise_id: null,
    enterprise_relationship_type: null,
    enterprise_adopted_at: null,
    original_subscription_id: null,
    original_subscription_status: null,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("organizations")
    .update(rollbackPayload)
    .eq("id", orgId);

  if (error) {
    console.error("[acceptAdoptionRequest] rollback failed, retrying:", error);
    // Single retry
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: retryError } = await (supabase as any)
      .from("organizations")
      .update(rollbackPayload)
      .eq("id", orgId);
    if (retryError) {
      console.error("[acceptAdoptionRequest] CRITICAL: rollback retry also failed:", retryError);
    }
  }
}

// Type for org with enterprise info (until types regenerated)
interface OrgRow {
  enterprise_id: string | null;
  name: string;
}

// Type for adoption request row
interface AdoptionRequestRow {
  id: string;
  enterprise_id: string;
  organization_id: string;
  requested_by: string;
  status: string;
  expires_at: string | null;
  enterprise?: unknown;
}

// Type for org subscription row
interface OrgSubscriptionRow {
  id: string;
  status: string;
  stripe_subscription_id: string | null;
}

export interface CreateAdoptionRequestResult {
  success: boolean;
  requestId?: string;
  error?: string;
  status?: number;
}

export async function createAdoptionRequest(
  enterpriseId: string,
  organizationId: string,
  requestedBy: string
): Promise<CreateAdoptionRequestResult> {
  const supabase = createServiceClient();

  // Check org is standalone
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: org, error: orgError } = await (supabase as any)
    .from("organizations")
    .select("enterprise_id, name")
    .eq("id", organizationId)
    .single() as { data: OrgRow | null; error: unknown };

  if (orgError) {
    console.error("[createAdoptionRequest] Failed to fetch organization:", orgError);
    return { success: false, error: "Failed to verify organization", status: 503 };
  }

  if (!org) {
    return { success: false, error: "Organization not found" };
  }

  if (org.enterprise_id) {
    return { success: false, error: "Organization already belongs to an enterprise" };
  }

  // Check quota
  const quotaCheck = await checkAdoptionQuota(enterpriseId, organizationId);
  if (!quotaCheck.allowed) {
    return { success: false, error: quotaCheck.error };
  }

  // Check for existing pending request
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing, error: existingError } = await (supabase as any)
    .from("enterprise_adoption_requests")
    .select("id, status")
    .eq("enterprise_id", enterpriseId)
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .maybeSingle();

  if (existingError) {
    console.error("[createAdoptionRequest] Failed to check for existing request:", existingError);
    return { success: false, error: "Failed to check for existing request", status: 503 };
  }

  if (existing) {
    return { success: false, error: "A pending adoption request already exists for this organization" };
  }

  // Create request
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ADOPTION_EXPIRY_DAYS);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: request, error } = await (supabase as any)
    .from("enterprise_adoption_requests")
    .insert({
      enterprise_id: enterpriseId,
      organization_id: organizationId,
      requested_by: requestedBy,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single() as { data: { id: string } | null; error: { message: string } | null };

  if (error) {
    console.error("[createAdoptionRequest] Insert failed:", error);
    return { success: false, error: "Failed to create adoption request", status: 500 };
  }

  return { success: true, requestId: request?.id };
}

export async function acceptAdoptionRequest(
  requestId: string,
  respondedBy: string
): Promise<{ success: boolean; error?: string; status?: number }> {
  const supabase = createServiceClient();

  // Get request with org and enterprise info
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: request } = await (supabase as any)
    .from("enterprise_adoption_requests")
    .select("*, enterprise:enterprises(*)")
    .eq("id", requestId)
    .single() as { data: AdoptionRequestRow | null };

  if (!request) {
    return { success: false, error: "Request not found" };
  }

  if (request.status !== "pending") {
    return { success: false, error: "Request has already been processed" };
  }

  // Check expiration (lazy expiration)
  if (request.expires_at && new Date(request.expires_at) < new Date()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from("enterprise_adoption_requests")
      .update({ status: "expired" })
      .eq("id", requestId);
    return { success: false, error: "Request has expired" };
  }

  // Re-verify org is standalone
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: org } = await (supabase as any)
    .from("organizations")
    .select("enterprise_id")
    .eq("id", request.organization_id)
    .single() as { data: { enterprise_id: string | null } | null };

  if (org?.enterprise_id) {
    return { success: false, error: "Organization already belongs to an enterprise" };
  }

  // Check alumni quota again
  const quotaCheck = await checkAdoptionQuota(request.enterprise_id, request.organization_id);
  if (!quotaCheck.allowed) {
    if (quotaCheck.status) {
      return { success: false, error: quotaCheck.error, status: quotaCheck.status };
    }
    return { success: false, error: quotaCheck.error };
  }

  // Check seat limit for enterprise-managed orgs
  const seatQuota = await canEnterpriseAddSubOrg(request.enterprise_id);
  if (seatQuota.error) {
    return { success: false, error: "Unable to verify seat limit. Please try again.", status: 503 };
  }

  // Get org's current subscription for preservation
  const { data: orgSub } = await supabase
    .from("organization_subscriptions")
    .select("id, status, stripe_subscription_id")
    .eq("organization_id", request.organization_id)
    .maybeSingle() as { data: OrgSubscriptionRow | null };

  // Execute adoption
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateError } = await (supabase as any)
    .from("organizations")
    .update({
      enterprise_id: request.enterprise_id,
      enterprise_relationship_type: "adopted",
      enterprise_adopted_at: new Date().toISOString(),
      original_subscription_id: orgSub?.id ?? null,
      original_subscription_status: orgSub?.status ?? null,
    })
    .eq("id", request.organization_id);

  if (updateError) {
    console.error("[acceptAdoptionRequest] Org update failed:", updateError);
    return { success: false, error: "Failed to update organization", status: 500 };
  }

  // Ensure org has a subscription row so the enterprise_alumni_counts view can
  // correctly include it for pooled alumni/seat enforcement.
  if (orgSub) {
    const { error: updateSubError } = await supabase
      .from("organization_subscriptions")
      .update({ status: "enterprise_managed" })
      .eq("id", orgSub.id);

    if (updateSubError) {
      console.error("[acceptAdoptionRequest] Failed to update organization subscription:", updateSubError);
      // Compensating rollback: revert enterprise_id on subscription failure (with retry)
      await rollbackOrgEnterprise(supabase, request.organization_id);
      return { success: false, error: "Failed to update organization subscription" };
    }
  } else {
    const { error: createSubError } = await supabase
      .from("organization_subscriptions")
      .insert({
        organization_id: request.organization_id,
        status: "enterprise_managed",
        base_plan_interval: "month", // Placeholder - billing handled at enterprise level
        alumni_bucket: "none", // Enterprise quota is pooled
      });

    if (createSubError) {
      console.error("[acceptAdoptionRequest] Failed to create organization subscription:", createSubError);
      // Compensating rollback: revert enterprise_id on subscription failure (with retry)
      await rollbackOrgEnterprise(supabase, request.organization_id);
      return { success: false, error: "Failed to create organization subscription" };
    }
  }

  // Step 3: Mark request as accepted
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: markAcceptedError } = await (supabase as any)
    .from("enterprise_adoption_requests")
    .update({
      status: "accepted",
      responded_by: respondedBy,
      responded_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  if (markAcceptedError) {
    console.error("[acceptAdoptionRequest] Step 3 (mark accepted) failed:", markAcceptedError);

    // Rollback step 1: revert org enterprise_id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: rollbackOrgError } = await (supabase as any)
      .from("organizations")
      .update({
        enterprise_id: null,
        enterprise_relationship_type: null,
        enterprise_adopted_at: null,
        original_subscription_id: null,
        original_subscription_status: null,
      })
      .eq("id", request.organization_id);

    if (rollbackOrgError) {
      console.error("[acceptAdoptionRequest] CRITICAL: step-3 rollback of org failed:", rollbackOrgError);
    }

    // Rollback step 2: revert subscription
    if (orgSub) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rollbackSubError } = await (supabase as any)
        .from("organization_subscriptions")
        .update({ status: orgSub.status })
        .eq("id", orgSub.id);

      if (rollbackSubError) {
        console.error("[acceptAdoptionRequest] CRITICAL: step-3 rollback of subscription failed:", rollbackSubError);
      }
    } else {
      // Remove the subscription row we created
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rollbackSubError } = await (supabase as any)
        .from("organization_subscriptions")
        .delete()
        .eq("organization_id", request.organization_id)
        .eq("status", "enterprise_managed");

      if (rollbackSubError) {
        console.error("[acceptAdoptionRequest] CRITICAL: step-3 rollback of new subscription failed:", rollbackSubError);
      }
    }

    return { success: false, error: "Failed to finalize adoption request", status: 500 };
  }

  return { success: true };
}

export async function rejectAdoptionRequest(
  requestId: string,
  respondedBy: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: request } = await (supabase as any)
    .from("enterprise_adoption_requests")
    .select("status")
    .eq("id", requestId)
    .single() as { data: { status: string } | null };

  if (!request) {
    return { success: false, error: "Request not found" };
  }

  if (request.status !== "pending") {
    return { success: false, error: "Request has already been processed" };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from("enterprise_adoption_requests")
    .update({
      status: "rejected",
      responded_by: respondedBy,
      responded_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  return { success: true };
}
