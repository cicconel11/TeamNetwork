export const MENTORSHIP_MENTOR_ROLES = ["alumni", "admin"] as const;
export const MENTORSHIP_MENTEE_ROLES = ["active_member"] as const;

export type MentorshipStatus = "active" | "paused" | "completed";

export interface MentorshipPairSummary {
  id: string;
  mentor_user_id: string;
  mentee_user_id: string;
  status?: string | null;
}

export interface PairableOrgMember {
  user_id: string;
  name: string | null;
  email: string | null;
}

export interface PairableOrgMemberRow {
  user_id: string;
  role: string;
  users:
    | {
        name: string | null;
        email: string | null;
      }
    | Array<{
        name: string | null;
        email: string | null;
      }>
    | null;
}

export function memberDisplayLabel(member: PairableOrgMember): string {
  return member.name ?? member.email ?? "Member";
}

export function partitionPairableOrgMembers(
  rows: PairableOrgMemberRow[]
): {
  mentors: PairableOrgMember[];
  mentees: PairableOrgMember[];
} {
  const mentorsById = new Map<string, PairableOrgMember>();
  const menteesById = new Map<string, PairableOrgMember>();

  for (const row of rows) {
    const userInfo = Array.isArray(row.users) ? row.users[0] : row.users;
    const member: PairableOrgMember = {
      user_id: row.user_id,
      name: userInfo?.name ?? null,
      email: userInfo?.email ?? null,
    };

    if ((MENTORSHIP_MENTOR_ROLES as readonly string[]).includes(row.role)) {
      if (!mentorsById.has(member.user_id)) {
        mentorsById.set(member.user_id, member);
      }
    }

    if ((MENTORSHIP_MENTEE_ROLES as readonly string[]).includes(row.role)) {
      if (!menteesById.has(member.user_id)) {
        menteesById.set(member.user_id, member);
      }
    }
  }

  return {
    mentors: sortPairableMembers(Array.from(mentorsById.values())),
    mentees: sortPairableMembers(Array.from(menteesById.values())),
  };
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
  if (deletedPairIds.length === 0) {
    return pairs;
  }

  const deleted = new Set(deletedPairIds);
  return pairs.filter((pair) => !deleted.has(pair.id));
}

export function isUserInMentorshipPair(
  pair: MentorshipPairSummary,
  currentUserId?: string
): boolean {
  if (!currentUserId) {
    return false;
  }

  return (
    pair.mentor_user_id === currentUserId || pair.mentee_user_id === currentUserId
  );
}

export function normalizeMentorshipStatus(status?: string | null): MentorshipStatus {
  if (status === "paused" || status === "completed") {
    return status;
  }

  return "active";
}

function sortPairableMembers(members: PairableOrgMember[]): PairableOrgMember[] {
  return [...members].sort((a, b) =>
    memberDisplayLabel(a)
      .toLowerCase()
      .localeCompare(memberDisplayLabel(b).toLowerCase())
  );
}
