/**
 * Pure helper functions for subscription reconciliation.
 * Extracted from the reconcile-subscription route to allow
 * both route and test imports without Next.js route export constraints.
 */

export interface RecoverableAttempt {
  id: string;
  stripe_checkout_session_id: string | null;
  status: string | null;
  organization_id: string | null;
  metadata: unknown;
  created_at: string | null;
}

interface SupabaseQueryError {
  code?: string;
  message: string;
}

interface AttemptLookupResult {
  data: RecoverableAttempt[] | null;
  error: SupabaseQueryError | null;
}

export function pickMostRecentRecoverableAttempt(input: {
  byOrgId: RecoverableAttempt[] | null;
  byPendingOrgId: RecoverableAttempt[] | null;
}): RecoverableAttempt | null {
  const taggedAttempts = [
    ...(input.byOrgId ?? []).map((attempt) => ({ attempt, source: "org" as const })),
    ...(input.byPendingOrgId ?? []).map((attempt) => ({ attempt, source: "metadata" as const })),
  ];

  if (taggedAttempts.length === 0) {
    return null;
  }

  const toSortTime = (value: string | null): number => {
    if (!value) return Number.NEGATIVE_INFINITY;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  };

  taggedAttempts.sort((a, b) => {
    const aTime = toSortTime(a.attempt.created_at);
    const bTime = toSortTime(b.attempt.created_at);

    if (aTime !== bTime) {
      return bTime - aTime;
    }

    if (a.source !== b.source) {
      return a.source === "org" ? -1 : 1;
    }

    return a.attempt.id.localeCompare(b.attempt.id);
  });

  return taggedAttempts[0]?.attempt ?? null;
}

export function resolveRecoverableAttemptLookup(input: {
  byOrgId: AttemptLookupResult;
  byPendingOrgId: AttemptLookupResult;
}): { attempt: RecoverableAttempt | null; error: string | null } {
  if (input.byOrgId.error || input.byPendingOrgId.error) {
    return {
      attempt: null,
      error: "Failed to query payment attempts for reconciliation.",
    };
  }

  return {
    attempt: pickMostRecentRecoverableAttempt({
      byOrgId: input.byOrgId.data,
      byPendingOrgId: input.byPendingOrgId.data,
    }),
    error: null,
  };
}
