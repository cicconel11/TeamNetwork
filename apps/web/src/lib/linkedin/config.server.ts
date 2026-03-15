import { getEncryptionKeyBuffer } from "@/lib/crypto/token-encryption";
import type { LinkedInIntegrationStatus } from "@/lib/linkedin/config";

/**
 * Whether LinkedIn login (Supabase Auth OIDC) is enabled.
 * Always true — the provider is configured in the Supabase Dashboard.
 */
export function isLinkedInLoginEnabled(): boolean {
  return true;
}

const REQUIRED_LINKEDIN_ENV_VARS = [
  "LINKEDIN_CLIENT_ID",
  "LINKEDIN_CLIENT_SECRET",
  "LINKEDIN_TOKEN_ENCRYPTION_KEY",
] as const;

export function getLinkedInIntegrationStatus(): LinkedInIntegrationStatus {
  const missingEnvVars = REQUIRED_LINKEDIN_ENV_VARS.filter((envVar) => {
    const value = process.env[envVar];
    return !value || value.trim() === "";
  });

  if (missingEnvVars.length > 0) {
    return {
      oauthAvailable: false,
      reason: "not_configured",
    };
  }

  try {
    getEncryptionKeyBuffer(process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY as string);
  } catch {
    return {
      oauthAvailable: false,
      reason: "not_configured",
    };
  }

  return {
    oauthAvailable: true,
    reason: null,
  };
}
