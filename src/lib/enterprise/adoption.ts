import { createServiceClient } from "@/lib/supabase/service";
import { checkAdoptionQuota } from "./quota";

const ADOPTION_EXPIRY_DAYS = 7;

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
}

export async function createAdoptionRequest(
  enterpriseId: string,
  organizationId: string,
  requestedBy: string
): Promise<CreateAdoptionRequestResult> {
  const supabase = createServiceClient();

  // Check org is standalone
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: org } = await (supabase as any)
    .from("organizations")
    .select("enterprise_id, name")
    .eq("id", organizationId)
    .single() as { data: OrgRow | null };

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
  const { data: existing } = await (supabase as any)
    .from("enterprise_adoption_requests")
    .select("id, status")
    .eq("enterprise_id", enterpriseId)
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .maybeSingle();

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
    return { success: false, error: error.message };
  }

  return { success: true, requestId: request?.id };
}

export async function acceptAdoptionRequest(
  requestId: string,
  respondedBy: string
): Promise<{ success: boolean; error?: string }> {
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

  // Check quota again
  const quotaCheck = await checkAdoptionQuota(request.enterprise_id, request.organization_id);
  if (!quotaCheck.allowed) {
    return { success: false, error: quotaCheck.error };
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
    return { success: false, error: updateError.message };
  }

  // Update org subscription status if exists
  if (orgSub) {
    await supabase
      .from("organization_subscriptions")
      .update({ status: "enterprise_managed" })
      .eq("id", orgSub.id);
  }

  // Mark request as accepted
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from("enterprise_adoption_requests")
    .update({
      status: "accepted",
      responded_by: respondedBy,
      responded_at: new Date().toISOString(),
    })
    .eq("id", requestId);

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
