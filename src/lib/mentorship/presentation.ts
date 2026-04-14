export interface MentorshipPairSummary {
  id: string;
  mentor_user_id: string;
  mentee_user_id: string;
  status?: string;
}

export function getMentorshipSectionOrder(params: {
  hasPairs: boolean;
  isAdmin: boolean;
}): "pairs-first" | "directory-first" {
  return params.hasPairs && !params.isAdmin ? "pairs-first" : "directory-first";
}

export function getVisibleMentorshipPairs<T extends MentorshipPairSummary>(
  pairs: T[],
  deletedPairIds: readonly string[]
): T[] {
  if (deletedPairIds.length === 0) return pairs;
  const deleted = new Set(deletedPairIds);
  return pairs.filter((pair) => !deleted.has(pair.id));
}

export function isUserInMentorshipPair(
  pair: MentorshipPairSummary,
  currentUserId?: string
): boolean {
  if (!currentUserId) return false;
  return (
    pair.mentee_user_id === currentUserId || pair.mentor_user_id === currentUserId
  );
}

export function canLogMentorshipActivity(params: {
  role: string | null | undefined;
  status: string | null | undefined;
}): boolean {
  return (
    params.status === "active" &&
    (params.role === "admin" || params.role === "active_member")
  );
}

export function getMentorshipStatusTranslationKey(status: string): string {
  switch (status) {
    case "completed":
      return "statusCompleted";
    case "paused":
      return "statusPaused";
    default:
      return "statusActive";
  }
}
