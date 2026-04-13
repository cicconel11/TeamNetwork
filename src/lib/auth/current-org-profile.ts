import type { OrgRole } from "@/lib/auth/role-utils";

type ProfileRecord = {
  id: string;
  first_name: string;
  last_name: string;
  photo_url: string | null;
};

export type CurrentOrgProfile = {
  href: string;
  name: string;
  avatarUrl: string | null;
  source: "members" | "alumni" | "parents";
};

type CurrentOrgProfileInput = {
  orgSlug: string;
  role: OrgRole | null;
  memberProfile?: ProfileRecord | null;
  alumniProfile?: ProfileRecord | null;
  parentProfile?: ProfileRecord | null;
};

const SOURCE_BY_ROLE: Partial<Record<OrgRole, "members" | "alumni" | "parents">> = {
  admin: "members",
  active_member: "members",
  alumni: "alumni",
  parent: "parents",
};

const PROFILE_PATH_BY_SOURCE = {
  members: "members",
  alumni: "alumni",
  parents: "parents",
} as const;

function toCurrentOrgProfile(
  orgSlug: string,
  source: "members" | "alumni" | "parents",
  profile: ProfileRecord,
): CurrentOrgProfile {
  return {
    href: `/${orgSlug}/${PROFILE_PATH_BY_SOURCE[source]}/${profile.id}`,
    name: `${profile.first_name} ${profile.last_name}`.trim(),
    avatarUrl: profile.photo_url,
    source,
  };
}

export function pickCurrentOrgProfile({
  orgSlug,
  role,
  memberProfile,
  alumniProfile,
  parentProfile,
}: CurrentOrgProfileInput): CurrentOrgProfile | null {
  const profilesBySource = {
    members: memberProfile ?? null,
    alumni: alumniProfile ?? null,
    parents: parentProfile ?? null,
  } as const;

  const preferredSource = role ? SOURCE_BY_ROLE[role] : undefined;
  if (preferredSource && profilesBySource[preferredSource]) {
    return toCurrentOrgProfile(orgSlug, preferredSource, profilesBySource[preferredSource]);
  }

  for (const source of ["members", "alumni", "parents"] as const) {
    const profile = profilesBySource[source];
    if (profile) {
      return toCurrentOrgProfile(orgSlug, source, profile);
    }
  }

  return null;
}
