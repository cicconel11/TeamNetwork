import { createServiceClient } from "@/lib/supabase/service";

export const CURRENT_TOS_VERSION = "2026-01-01";
export const CURRENT_PRIVACY_VERSION = "2026-02-10";

export type AgreementType = "terms_of_service" | "privacy_policy";

export interface UserAgreementVersion {
  agreement_type: AgreementType;
  version: string;
}

export function hasAcceptedCurrentAgreementVersions(
  agreements: UserAgreementVersion[],
): boolean {
  let hasCurrentTerms = false;
  let hasCurrentPrivacy = false;

  for (const agreement of agreements) {
    if (
      agreement.agreement_type === "terms_of_service" &&
      agreement.version === CURRENT_TOS_VERSION
    ) {
      hasCurrentTerms = true;
    }

    if (
      agreement.agreement_type === "privacy_policy" &&
      agreement.version === CURRENT_PRIVACY_VERSION
    ) {
      hasCurrentPrivacy = true;
    }
  }

  return hasCurrentTerms && hasCurrentPrivacy;
}

/**
 * Record a user's acceptance of a ToS or Privacy Policy version.
 * Duplicate inserts are treated as success so users can safely retry.
 */
export async function recordUserAgreement(params: {
  userId: string;
  agreementType: AgreementType;
  version: string;
  ipHash: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const { userId, agreementType, version, ipHash } = params;

  try {
    const serviceClient = createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (serviceClient as any)
      .from("user_agreements")
      .insert({
        user_id: userId,
        agreement_type: agreementType,
        version,
        ip_hash: ipHash,
      });

    if (error) {
      // Unique constraint violation = already accepted this version
      if (error.code === "23505") {
        return { success: true };
      }
      console.error("[compliance/user-agreements] Failed to record:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error("[compliance/user-agreements] Exception:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Record acceptance of both ToS and Privacy Policy at current versions.
 */
export async function recordBothAgreements(params: {
  userId: string;
  ipHash: string | null;
}): Promise<boolean> {
  const results = await Promise.all([
    recordUserAgreement({
      userId: params.userId,
      agreementType: "terms_of_service",
      version: CURRENT_TOS_VERSION,
      ipHash: params.ipHash,
    }),
    recordUserAgreement({
      userId: params.userId,
      agreementType: "privacy_policy",
      version: CURRENT_PRIVACY_VERSION,
      ipHash: params.ipHash,
    }),
  ]);

  return results.every((result) => result.success);
}
