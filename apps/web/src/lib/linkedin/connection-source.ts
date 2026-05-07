export const LINKEDIN_OIDC_SOURCE = "oidc_login" as const;
export const LINKEDIN_OIDC_TOKEN_SENTINEL = "__oidc_login__";
export const LINKEDIN_OAUTH_SOURCE = "oauth" as const;

export type LinkedInConnectionSource =
  | typeof LINKEDIN_OAUTH_SOURCE
  | typeof LINKEDIN_OIDC_SOURCE;

interface LinkedInSourceRow {
  access_token_encrypted?: string | null;
  linkedin_data?: {
    source?: unknown;
  } | null;
}

export function getLinkedInConnectionSource(
  row: LinkedInSourceRow | null | undefined,
): LinkedInConnectionSource {
  if (!row) {
    return LINKEDIN_OAUTH_SOURCE;
  }

  if (row.linkedin_data?.source === LINKEDIN_OIDC_SOURCE) {
    return LINKEDIN_OIDC_SOURCE;
  }

  if (row.access_token_encrypted === LINKEDIN_OIDC_TOKEN_SENTINEL) {
    return LINKEDIN_OIDC_SOURCE;
  }

  return LINKEDIN_OAUTH_SOURCE;
}
