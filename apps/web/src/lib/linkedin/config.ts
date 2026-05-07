export const LINKEDIN_INTEGRATION_DISABLED_CODE = "linkedin_integration_disabled";

export const LINKEDIN_OIDC_PROVIDER = "linkedin_oidc" as const;

export interface LinkedInIntegrationStatus {
  oauthAvailable: boolean;
  reason: "not_configured" | null;
}

export function getLinkedInIntegrationDisabledMessage(): string {
  return "LinkedIn integration is not configured. Please contact support.";
}
