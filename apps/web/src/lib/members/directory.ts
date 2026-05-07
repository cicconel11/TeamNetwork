export interface LinkedMemberDirectoryRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  photo_url: string | null;
  role: string | null;
  status: string | null;
  graduation_year: number | null;
  linkedin_url: string | null;
  user_id: string | null;
  current_company: string | null;
  current_city: string | null;
}

export interface ParentDirectoryRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  photo_url: string | null;
  linkedin_url: string | null;
  relationship: string | null;
  student_name: string | null;
  user_id: string | null;
}

export interface MemberDirectoryEntry {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  photo_url: string | null;
  role: string | null;
  status: string | null;
  graduation_year: number | null;
  linkedin_url: string | null;
  current_company: string | null;
  current_city: string | null;
  /** user_id of the underlying account, when this row maps to one. */
  user_id: string | null;
  isAdmin: boolean;
  isParent: boolean;
  profileHref: string;
}

export function buildMemberDirectoryEntries(params: {
  orgSlug: string;
  linkedMembers: LinkedMemberDirectoryRow[];
  manualMembers: LinkedMemberDirectoryRow[];
  parentProfiles: ParentDirectoryRow[];
  adminUserIds: Set<string>;
}): MemberDirectoryEntry[] {
  const { orgSlug, linkedMembers, manualMembers, parentProfiles, adminUserIds } = params;

  const linkedUserIds = new Set(
    linkedMembers
      .map((member) => member.user_id)
      .filter((userId): userId is string => Boolean(userId)),
  );

  const entries: MemberDirectoryEntry[] = [
    ...linkedMembers.map((member) => ({
      id: member.id,
      first_name: member.first_name,
      last_name: member.last_name,
      email: member.email,
      photo_url: member.photo_url,
      role: member.role,
      status: member.status,
      graduation_year: member.graduation_year,
      linkedin_url: member.linkedin_url,
      current_company: member.current_company,
      current_city: member.current_city,
      user_id: member.user_id,
      isAdmin: member.user_id ? adminUserIds.has(member.user_id) : false,
      isParent: false,
      profileHref: `/${orgSlug}/members/${member.id}`,
    })),
    ...manualMembers.map((member) => ({
      id: member.id,
      first_name: member.first_name,
      last_name: member.last_name,
      email: member.email,
      photo_url: member.photo_url,
      role: member.role,
      status: member.status,
      graduation_year: member.graduation_year,
      linkedin_url: member.linkedin_url,
      current_company: member.current_company,
      current_city: member.current_city,
      user_id: member.user_id,
      isAdmin: false,
      isParent: false,
      profileHref: `/${orgSlug}/members/${member.id}`,
    })),
    ...parentProfiles
      .filter((parent) => parent.user_id && !linkedUserIds.has(parent.user_id))
      .map((parent) => ({
        id: `parent-${parent.id}`,
        first_name: parent.first_name,
        last_name: parent.last_name,
        email: parent.email,
        photo_url: parent.photo_url,
        role: parent.student_name ? `Parent of ${parent.student_name}` : "Parent",
        status: "active",
        graduation_year: null,
        linkedin_url: parent.linkedin_url,
        current_company: null,
        current_city: null,
        user_id: parent.user_id,
        isAdmin: false,
        isParent: true,
        profileHref: `/${orgSlug}/parents/${parent.id}`,
      })),
  ];

  return entries.sort((a, b) => a.last_name.localeCompare(b.last_name));
}
