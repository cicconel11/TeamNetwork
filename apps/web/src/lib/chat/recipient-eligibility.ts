export const CHAT_ELIGIBLE_ORG_ROLES = ["admin", "active_member", "alumni", "parent"] as const;

export type ChatEligibleOrgRole = (typeof CHAT_ELIGIBLE_ORG_ROLES)[number];

export type ChatProfileCandidate = {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  photo_url: string | null;
  role: string | null;
  profileType: "member" | "alumni";
};

export type ChatMemberProfileRow = {
  id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  photo_url: string | null;
  role?: string | null;
};

export type ChatAlumniProfileRow = {
  id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  photo_url: string | null;
  job_title?: string | null;
  position_title?: string | null;
};

export function uniqueChatEligibleUserIds(
  activeRoles: Array<{ user_id?: string | null }>,
): string[] {
  return [
    ...new Set(
      activeRoles
        .map((row) => row.user_id)
        .filter((userId): userId is string => Boolean(userId)),
    ),
  ];
}

export function mergeChatProfileCandidates(input: {
  members: ChatMemberProfileRow[];
  alumni: ChatAlumniProfileRow[];
}): ChatProfileCandidate[] {
  const peopleByUserId = new Map<string, ChatProfileCandidate>();

  for (const member of input.members) {
    if (!member.user_id) continue;
    peopleByUserId.set(member.user_id, {
      id: member.id,
      user_id: member.user_id,
      first_name: member.first_name,
      last_name: member.last_name,
      email: member.email,
      photo_url: member.photo_url,
      role: member.role ?? null,
      profileType: "member",
    });
  }

  for (const alum of input.alumni) {
    if (!alum.user_id || peopleByUserId.has(alum.user_id)) continue;
    peopleByUserId.set(alum.user_id, {
      id: alum.id,
      user_id: alum.user_id,
      first_name: alum.first_name,
      last_name: alum.last_name,
      email: alum.email,
      photo_url: alum.photo_url,
      role: alum.position_title || alum.job_title || "Alumni",
      profileType: "alumni",
    });
  }

  return Array.from(peopleByUserId.values());
}
