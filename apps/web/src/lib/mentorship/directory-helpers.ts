export interface DirectoryMentorLike {
  user_id: string;
  name: string;
  industry: string | null;
  graduation_year: number | null;
  topics: string[] | null;
  sports?: string[] | null;
  positions?: string[] | null;
  accepting_new: boolean;
}

export interface DirectoryFilters {
  nameSearch: string;
  industry: string;
  year: string;
  topic: string;
  sport: string;
  position: string;
  acceptingOnly: boolean;
}

export function emptyFilters(): DirectoryFilters {
  return {
    nameSearch: "",
    industry: "",
    year: "",
    topic: "",
    sport: "",
    position: "",
    acceptingOnly: true,
  };
}

export function hasActiveFilters(f: DirectoryFilters): boolean {
  return (
    f.nameSearch !== "" ||
    f.industry !== "" ||
    f.year !== "" ||
    f.topic !== "" ||
    f.sport !== "" ||
    f.position !== "" ||
    !f.acceptingOnly
  );
}

/** Caller is excluded from their own directory view. */
export function excludeSelf<M extends { user_id: string }>(
  mentors: readonly M[],
  currentUserId: string
): M[] {
  if (!currentUserId) return [...mentors];
  return mentors.filter((m) => m.user_id !== currentUserId);
}

export function applyFilters<M extends DirectoryMentorLike>(
  mentors: readonly M[],
  filters: DirectoryFilters
): M[] {
  const q = filters.nameSearch.trim().toLowerCase();
  return mentors.filter((m) => {
    if (q && !m.name.toLowerCase().includes(q)) return false;
    if (filters.industry && m.industry !== filters.industry) return false;
    if (filters.year && m.graduation_year?.toString() !== filters.year) return false;
    if (filters.topic && !(m.topics ?? []).includes(filters.topic)) return false;
    if (filters.sport && !(m.sports ?? []).includes(filters.sport)) return false;
    if (filters.position && !(m.positions ?? []).includes(filters.position)) return false;
    if (filters.acceptingOnly && !m.accepting_new) return false;
    return true;
  });
}

/** Decide whether a mentor card should show the "Request sent" badge. */
export function hasPendingRequest(
  pendingIds: readonly string[],
  mentorUserId: string
): boolean {
  return pendingIds.includes(mentorUserId);
}
