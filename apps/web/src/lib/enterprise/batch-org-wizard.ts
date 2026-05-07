import type { BatchOrgInviteResult } from "./batch-org-invites";

export interface EnterpriseMemberRecord {
  userId: string;
  email: string;
  fullName: string;
  organizations: Array<{
    orgId: string;
    orgName: string;
    orgSlug: string;
    role: string;
  }>;
}

export interface BatchCreateOrganizationResult {
  out_slug: string;
  out_org_id: string | null;
  out_status: string;
}

export interface BatchCreateMemberResult {
  orgSlug: string;
  userId: string;
  action: string;
  ok: boolean;
  error?: string;
}

export interface BatchCreateSummary {
  orgsCreated?: number;
  orgsFailed?: number;
  membersProcessed?: number;
  membersFailed?: number;
  invitesCreated?: number;
  invitesSent?: number;
  invitesFailed?: number;
  invitesSkipped?: number;
}

export interface BatchOrgSubmissionResult {
  organizations: BatchCreateOrganizationResult[];
  memberResults: BatchCreateMemberResult[];
  inviteResults: BatchOrgInviteResult[];
  summary?: BatchCreateSummary;
}

interface MemberPage {
  members: EnterpriseMemberRecord[];
  nextCursor: string | null;
}

function mergeOrganizations(
  existing: EnterpriseMemberRecord["organizations"],
  incoming: EnterpriseMemberRecord["organizations"]
) {
  const merged = [...existing];
  const seen = new Set(existing.map((organization) => organization.orgId));

  for (const organization of incoming) {
    if (seen.has(organization.orgId)) continue;
    seen.add(organization.orgId);
    merged.push(organization);
  }

  return merged;
}

export function mergeEnterpriseMembers(
  existing: EnterpriseMemberRecord[],
  incoming: EnterpriseMemberRecord[]
): EnterpriseMemberRecord[] {
  const members = new Map(existing.map((member) => [member.userId, member]));

  for (const member of incoming) {
    const current = members.get(member.userId);

    if (!current) {
      members.set(member.userId, member);
      continue;
    }

    members.set(member.userId, {
      ...current,
      email: current.email || member.email,
      fullName: current.fullName || member.fullName,
      organizations: mergeOrganizations(current.organizations, member.organizations),
    });
  }

  return Array.from(members.values());
}

export async function fetchAllEnterpriseMembers(
  fetchPage: (after: string | null) => Promise<MemberPage>
): Promise<EnterpriseMemberRecord[]> {
  let members: EnterpriseMemberRecord[] = [];
  let after: string | null = null;

  do {
    const page = await fetchPage(after);
    members = mergeEnterpriseMembers(members, page.members);
    after = page.nextCursor;
  } while (after !== null);

  return members;
}

export function shouldRedirectAfterBatchCreate(
  summary?: Partial<BatchCreateSummary> | null
): boolean {
  return (summary?.orgsFailed ?? 0) === 0
    && (summary?.membersFailed ?? 0) === 0
    && (summary?.invitesFailed ?? 0) === 0;
}
