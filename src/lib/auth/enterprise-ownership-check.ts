/**
 * Pure helper for resolving enterprise ownership checks during account deletion.
 * Extracted from the delete-account route to avoid Next.js route export constraints.
 */

interface QueryErrorLike {
  code?: string;
  message: string;
}

interface EnterpriseOwnerRole {
  enterprise_id: string;
  role: string;
}

export function resolveEnterpriseOwnershipCheck(input: {
  enterpriseRoles: EnterpriseOwnerRole[] | null;
  error: QueryErrorLike | null;
}): { isOwner: boolean; error: string | null } {
  if (input.error) {
    return {
      isOwner: false,
      error: "Failed to verify enterprise ownership",
    };
  }

  return {
    isOwner: Boolean(input.enterpriseRoles && input.enterpriseRoles.length > 0),
    error: null,
  };
}
