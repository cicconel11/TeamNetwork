import {
  canonicalizeIndustry,
  canonicalizeRoleFamily,
  parseMemberCareerString,
} from "@/lib/people-graph/career-signals";

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
  open_to_networking: boolean | null;
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
  open_to_networking: boolean | null;
  created_at: string | null;
}

export interface ParentPersonRow {
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
  position_title: string | null;
  job_title: string | null;
  open_to_networking: boolean | null;
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
  personType: "member" | "alumni" | "parent";
  personId: string;
  memberId: string | null;
  alumniId: string | null;
  parentId: string | null;
  userId: string | null;
  name: string;
  email: string | null;
  role: string | null;
  major: string | null;
  currentCompany: string | null;
  industry: string | null;
  roleFamily: string | null;
  graduationYear: number | null;
  currentCity: string | null;
  // Self-set networking-consent flag (members/alumni/parents alike). The engine
  // gates alumni→alumni edges on the SOURCE's value, and only surfaces parents
  // who opted in. Defaults false when no contributing row has set it.
  openToNetworking: boolean;
}

export const MEMBER_PERSON_SELECT =
  "id, organization_id, user_id, deleted_at, status, first_name, last_name, email, role, current_company, graduation_year, open_to_networking, created_at";

export const ALUMNI_PERSON_SELECT =
  "id, organization_id, user_id, deleted_at, first_name, last_name, email, major, current_company, industry, current_city, graduation_year, position_title, job_title, open_to_networking, created_at";

export const PARENT_PERSON_SELECT =
  "id, organization_id, user_id, deleted_at, first_name, last_name, email, major, current_company, industry, current_city, position_title, job_title, open_to_networking, created_at";

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

function projectMemberCareer(member: MemberPersonRow) {
  return parseMemberCareerString(member.current_company);
}

export function buildPersonKey(
  sourceTable: "members" | "alumni" | "parents",
  sourceId: string,
  userId: string | null | undefined
): string {
  if (userId) {
    return `user:${userId}`;
  }

  if (sourceTable === "members") return `member:${sourceId}`;
  if (sourceTable === "alumni") return `alumni:${sourceId}`;
  return `parent:${sourceId}`;
}

export function isActiveMemberRow(row: MemberPersonRow): boolean {
  return row.deleted_at === null && row.status === "active";
}

export function isActiveAlumniRow(row: AlumniPersonRow): boolean {
  return row.deleted_at === null;
}

export function isActiveParentRow(row: ParentPersonRow): boolean {
  return row.deleted_at === null;
}

export function isActiveMentorshipPairRow(row: MentorshipPairSyncRow): boolean {
  return row.deleted_at === null && row.status === "active";
}

/**
 * Consent follows the identity that will be surfaced. A linked user who is both
 * a member and a parent projects as a member (personhood precedence), so only
 * their member rows decide openToNetworking — opting in as a parent must not
 * expose the member identity, and vice versa.
 */
function primaryRowsOptedIn(
  personType: ProjectedPerson["personType"],
  group: {
    members: Array<{ open_to_networking: boolean | null }>;
    alumni: Array<{ open_to_networking: boolean | null }>;
    parents: Array<{ open_to_networking: boolean | null }>;
  }
): boolean {
  const rows =
    personType === "member" ? group.members : personType === "alumni" ? group.alumni : group.parents;
  return rows.some((row) => row.open_to_networking === true);
}

export function buildProjectedPeople(input: {
  members: MemberPersonRow[];
  alumni: AlumniPersonRow[];
  parents?: ParentPersonRow[];
}): Map<string, ProjectedPerson> {
  const groups = new Map<
    string,
    {
      orgId: string;
      personKey: string;
      userId: string | null;
      members: MemberPersonRow[];
      alumni: AlumniPersonRow[];
      parents: ParentPersonRow[];
    }
  >();

  const ensureGroup = (orgId: string, personKey: string, userId: string | null) => {
    const groupKey = `${orgId}:${personKey}`;
    const existing = groups.get(groupKey);
    if (existing) {
      return existing;
    }
    const group = {
      orgId,
      personKey,
      userId,
      members: [] as MemberPersonRow[],
      alumni: [] as AlumniPersonRow[],
      parents: [] as ParentPersonRow[],
    };
    groups.set(groupKey, group);
    return group;
  };

  for (const member of input.members.filter(isActiveMemberRow).sort(stableRowSort)) {
    const personKey = buildPersonKey("members", member.id, member.user_id);
    ensureGroup(member.organization_id, personKey, member.user_id).members.push(member);
  }

  for (const alumni of input.alumni.filter(isActiveAlumniRow).sort(stableRowSort)) {
    const personKey = buildPersonKey("alumni", alumni.id, alumni.user_id);
    ensureGroup(alumni.organization_id, personKey, alumni.user_id).alumni.push(alumni);
  }

  for (const parent of (input.parents ?? []).filter(isActiveParentRow).sort(stableRowSort)) {
    const personKey = buildPersonKey("parents", parent.id, parent.user_id);
    ensureGroup(parent.organization_id, personKey, parent.user_id).parents.push(parent);
  }

  const projected = new Map<string, ProjectedPerson>();

  for (const [groupKey, group] of groups.entries()) {
    const primaryMember = group.members[0] ?? null;
    const primaryAlumni = group.alumni[0] ?? null;
    const primaryParent = group.parents[0] ?? null;
    const projectedMemberCareers = group.members.map(projectMemberCareer);
    // Personhood precedence: member > alumni > parent. A linked user who is both a
    // member and a parent surfaces as a member (their primary in-org identity).
    const personType: ProjectedPerson["personType"] = primaryMember
      ? "member"
      : primaryAlumni
        ? "alumni"
        : "parent";
    const personId = primaryMember?.id ?? primaryAlumni?.id ?? primaryParent?.id;

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
      pickFirstText(
        group.parents.map((parent) =>
          buildDisplayName({
            firstName: parent.first_name,
            lastName: parent.last_name,
            email: parent.email,
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
      parentId: primaryParent?.id ?? null,
      userId: group.userId,
      name,
      email: pickFirstText([
        ...group.members.map((member) => member.email),
        ...group.alumni.map((alumni) => alumni.email),
        ...group.parents.map((parent) => parent.email),
      ]),
      role: pickFirstText([
        primaryAlumni?.position_title,
        primaryAlumni?.job_title,
        primaryParent?.position_title,
        primaryParent?.job_title,
        primaryMember?.role,
      ]),
      major: pickFirstText([
        ...group.alumni.map((alumni) => alumni.major),
        ...group.parents.map((parent) => parent.major),
      ]),
      currentCompany: pickFirstText([
        ...group.alumni.map((alumni) => alumni.current_company),
        ...group.parents.map((parent) => parent.current_company),
        ...projectedMemberCareers.map((career) => career.employer),
      ]),
      industry: pickFirstText([
        ...group.alumni.map((alumni) => canonicalizeIndustry(alumni.industry)),
        ...group.parents.map((parent) => canonicalizeIndustry(parent.industry)),
        ...projectedMemberCareers.map((career) => career.canonicalIndustry),
      ]),
      roleFamily: pickFirstText([
        ...group.alumni.map((alumni) =>
          canonicalizeRoleFamily(
            pickFirstText([alumni.position_title, alumni.job_title]),
            alumni.current_company,
            canonicalizeIndustry(alumni.industry)
          )
        ),
        ...group.parents.map((parent) =>
          canonicalizeRoleFamily(
            pickFirstText([parent.position_title, parent.job_title]),
            parent.current_company,
            canonicalizeIndustry(parent.industry)
          )
        ),
        ...projectedMemberCareers.map((career) => career.roleFamily),
      ]),
      graduationYear: pickFirstNumber([
        ...group.alumni.map((alumni) => alumni.graduation_year),
        ...group.members.map((member) => member.graduation_year),
      ]),
      currentCity: pickFirstText([
        ...group.alumni.map((alumni) => alumni.current_city),
        ...group.parents.map((parent) => parent.current_city),
      ]),
      openToNetworking: primaryRowsOptedIn(personType, group),
    });
  }

  return projected;
}

export function buildSourcePerson(input: {
  memberRows: MemberPersonRow[];
  alumniRows: AlumniPersonRow[];
  parentRows?: ParentPersonRow[];
}): ProjectedPerson | null {
  if (
    input.memberRows.length === 0 &&
    input.alumniRows.length === 0 &&
    (input.parentRows?.length ?? 0) === 0
  ) {
    return null;
  }

  const projected = buildProjectedPeople({
    members: input.memberRows,
    alumni: input.alumniRows,
    parents: input.parentRows ?? [],
  });
  const entry = projected.values().next();
  return entry.done ? null : entry.value;
}
