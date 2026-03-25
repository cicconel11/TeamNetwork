export interface MemberPersonRow {
  id: string;
  organization_id: string;
  user_id: string | null;
  deleted_at: string | null;
  status: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  role: string | null;
  current_company: string | null;
  graduation_year: number | null;
  created_at: string | null;
}

export interface AlumniPersonRow {
  id: string;
  organization_id: string;
  user_id: string | null;
  deleted_at: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  major: string | null;
  current_company: string | null;
  industry: string | null;
  current_city: string | null;
  graduation_year: number | null;
  position_title: string | null;
  job_title: string | null;
  created_at: string | null;
}

export interface MentorshipPairSyncRow {
  id: string;
  organization_id: string;
  mentor_user_id: string;
  mentee_user_id: string;
  status: string;
  deleted_at: string | null;
}

export interface ProjectedPerson {
  orgId: string;
  personKey: string;
  personType: "member" | "alumni";
  personId: string;
  memberId: string | null;
  alumniId: string | null;
  userId: string | null;
  name: string;
  email: string | null;
  role: string | null;
  major: string | null;
  currentCompany: string | null;
  industry: string | null;
  graduationYear: number | null;
  currentCity: string | null;
}

export const MEMBER_PERSON_SELECT =
  "id, organization_id, user_id, deleted_at, status, first_name, last_name, email, role, current_company, graduation_year, created_at";

export const ALUMNI_PERSON_SELECT =
  "id, organization_id, user_id, deleted_at, first_name, last_name, email, major, current_company, industry, current_city, graduation_year, position_title, job_title, created_at";

export const MENTORSHIP_PAIR_SELECT =
  "id, organization_id, mentor_user_id, mentee_user_id, status, deleted_at";

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function compareNullableStrings(a: string | null | undefined, b: string | null | undefined) {
  const normalizedA = a ?? "";
  const normalizedB = b ?? "";
  return normalizedA.localeCompare(normalizedB);
}

function stableRowSort<T extends { created_at: string | null; id: string }>(a: T, b: T) {
  const createdComparison = compareNullableStrings(a.created_at, b.created_at);
  if (createdComparison !== 0) {
    return createdComparison;
  }
  return a.id.localeCompare(b.id);
}

function buildDisplayName(parts: {
  firstName: string;
  lastName: string;
  email?: string | null;
  fallback?: string;
}): string {
  const fullName = [parts.firstName.trim(), parts.lastName.trim()].filter(Boolean).join(" ").trim();
  if (fullName.length > 0 && fullName !== "Member") {
    return fullName;
  }

  const email = normalizeOptionalText(parts.email);
  if (email) {
    return email;
  }

  return parts.fallback ?? "Unknown person";
}

function pickFirstText(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = normalizeOptionalText(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function pickFirstNumber(values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === "number") {
      return value;
    }
  }
  return null;
}

export function buildPersonKey(
  sourceTable: "members" | "alumni",
  sourceId: string,
  userId: string | null | undefined
): string {
  if (userId) {
    return `user:${userId}`;
  }

  return sourceTable === "members" ? `member:${sourceId}` : `alumni:${sourceId}`;
}

export function isActiveMemberRow(row: MemberPersonRow): boolean {
  return row.deleted_at === null && row.status === "active";
}

export function isActiveAlumniRow(row: AlumniPersonRow): boolean {
  return row.deleted_at === null;
}

export function isActiveMentorshipPairRow(row: MentorshipPairSyncRow): boolean {
  return row.deleted_at === null && row.status === "active";
}

export function buildProjectedPeople(input: {
  members: MemberPersonRow[];
  alumni: AlumniPersonRow[];
}): Map<string, ProjectedPerson> {
  const groups = new Map<
    string,
    {
      orgId: string;
      personKey: string;
      userId: string | null;
      members: MemberPersonRow[];
      alumni: AlumniPersonRow[];
    }
  >();

  for (const member of input.members.filter(isActiveMemberRow).sort(stableRowSort)) {
    const personKey = buildPersonKey("members", member.id, member.user_id);
    const groupKey = `${member.organization_id}:${personKey}`;
    const group = groups.get(groupKey) ?? {
      orgId: member.organization_id,
      personKey,
      userId: member.user_id,
      members: [],
      alumni: [],
    };
    group.members.push(member);
    groups.set(groupKey, group);
  }

  for (const alumni of input.alumni.filter(isActiveAlumniRow).sort(stableRowSort)) {
    const personKey = buildPersonKey("alumni", alumni.id, alumni.user_id);
    const groupKey = `${alumni.organization_id}:${personKey}`;
    const group = groups.get(groupKey) ?? {
      orgId: alumni.organization_id,
      personKey,
      userId: alumni.user_id,
      members: [],
      alumni: [],
    };
    group.alumni.push(alumni);
    groups.set(groupKey, group);
  }

  const projected = new Map<string, ProjectedPerson>();

  for (const [groupKey, group] of groups.entries()) {
    const primaryMember = group.members[0] ?? null;
    const primaryAlumni = group.alumni[0] ?? null;
    const personType = primaryMember ? "member" : "alumni";
    const personId = primaryMember?.id ?? primaryAlumni?.id;

    if (!personId) {
      continue;
    }

    const name =
      pickFirstText(
        group.members.map((member) =>
          buildDisplayName({
            firstName: member.first_name,
            lastName: member.last_name,
            email: member.email,
          })
        )
      ) ??
      pickFirstText(
        group.alumni.map((alumni) =>
          buildDisplayName({
            firstName: alumni.first_name,
            lastName: alumni.last_name,
            email: alumni.email,
          })
        )
      ) ??
      `Person ${group.personKey}`;

    projected.set(groupKey, {
      orgId: group.orgId,
      personKey: group.personKey,
      personType,
      personId,
      memberId: primaryMember?.id ?? null,
      alumniId: primaryAlumni?.id ?? null,
      userId: group.userId,
      name,
      email: pickFirstText([
        ...group.members.map((member) => member.email),
        ...group.alumni.map((alumni) => alumni.email),
      ]),
      role: pickFirstText([
        primaryAlumni?.position_title,
        primaryAlumni?.job_title,
        primaryMember?.role,
      ]),
      major: pickFirstText(group.alumni.map((alumni) => alumni.major)),
      currentCompany: pickFirstText([
        ...group.alumni.map((alumni) => alumni.current_company),
        ...group.members.map((member) => member.current_company),
      ]),
      industry: pickFirstText(group.alumni.map((alumni) => alumni.industry)),
      graduationYear: pickFirstNumber([
        ...group.alumni.map((alumni) => alumni.graduation_year),
        ...group.members.map((member) => member.graduation_year),
      ]),
      currentCity: pickFirstText(group.alumni.map((alumni) => alumni.current_city)),
    });
  }

  return projected;
}

export function buildSourcePerson(input: {
  memberRows: MemberPersonRow[];
  alumniRows: AlumniPersonRow[];
}): ProjectedPerson | null {
  if (input.memberRows.length === 0 && input.alumniRows.length === 0) {
    return null;
  }

  const projected = buildProjectedPeople({
    members: input.memberRows,
    alumni: input.alumniRows,
  });
  const entry = projected.values().next();
  return entry.done ? null : entry.value;
}
