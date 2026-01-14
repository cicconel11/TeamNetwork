export type LinkedInImportPreviewStatus =
  | "will_update"
  | "will_skip"
  | "quota_blocked"
  | "will_create";

export interface LinkedInImportRow {
  email: string;
  linkedin_url: string;
}

export interface LinkedInImportMatch {
  id: string;
  linkedin_url: string | null;
}

export interface LinkedInImportCreateRow {
  email: string;
  linkedinUrl: string;
  first_name: string;
  last_name: string;
}

export interface LinkedInImportUpdateRow {
  alumniId: string;
  linkedinUrl: string;
}

export interface LinkedInImportPlan {
  toUpdate: LinkedInImportUpdateRow[];
  toCreate: LinkedInImportCreateRow[];
  preview: Record<string, LinkedInImportPreviewStatus>;
  skipped: number;
  quotaBlocked: number;
}

export interface LinkedInImportCapacityDeps {
  getAlumniLimitForOrg: (organizationId: string) => Promise<number | null>;
  getEnterpriseIdForOrg: (organizationId: string) => Promise<string | null>;
  countAlumniForOrg: (organizationId: string) => Promise<number>;
  countAlumniForEnterprise: (enterpriseId: string) => Promise<number>;
}

export interface LinkedInImportCapacitySnapshot {
  alumniLimit: number | null;
  currentAlumniCount: number;
  remainingCapacity: number;
  scope: "organization" | "enterprise";
}

export function normalizeLinkedInImportRows(rows: LinkedInImportRow[]): LinkedInImportRow[] {
  const seenEmails = new Set<string>();
  const deduped: LinkedInImportRow[] = [];

  for (const row of rows) {
    const email = row.email.toLowerCase();
    if (seenEmails.has(email)) {
      continue;
    }

    seenEmails.add(email);
    deduped.push({
      email,
      linkedin_url: row.linkedin_url,
    });
  }

  return deduped;
}

export function deriveNameFromEmail(email: string): { first_name: string; last_name: string } {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]/).filter(Boolean);
  const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

  if (parts.length >= 2) {
    return {
      first_name: capitalize(parts[0]),
      last_name: capitalize(parts[parts.length - 1]),
    };
  }

  return {
    first_name: capitalize(local || "Unknown"),
    last_name: "",
  };
}

export function planLinkedInImport(params: {
  rows: LinkedInImportRow[];
  overwrite: boolean;
  dryRun: boolean;
  alumniByEmail: Map<string, LinkedInImportMatch>;
  remainingCapacity: number;
}): LinkedInImportPlan {
  const { overwrite, dryRun, alumniByEmail, remainingCapacity } = params;
  const rows = normalizeLinkedInImportRows(params.rows);

  const toUpdate: LinkedInImportUpdateRow[] = [];
  const toCreate: LinkedInImportCreateRow[] = [];
  const preview: Record<string, LinkedInImportPreviewStatus> = {};
  let skipped = 0;
  let quotaBlocked = 0;

  for (const row of rows) {
    const emailKey = row.email.toLowerCase();
    const match = alumniByEmail.get(emailKey);

    if (!match) {
      if (toCreate.length < remainingCapacity) {
        const { first_name, last_name } = deriveNameFromEmail(emailKey);
        toCreate.push({
          email: emailKey,
          linkedinUrl: row.linkedin_url,
          first_name,
          last_name,
        });
        if (dryRun) preview[emailKey] = "will_create";
      } else {
        quotaBlocked++;
        if (dryRun) preview[emailKey] = "quota_blocked";
      }
      continue;
    }

    if (match.linkedin_url && !overwrite) {
      skipped++;
      if (dryRun) preview[emailKey] = "will_skip";
      continue;
    }

    toUpdate.push({ alumniId: match.id, linkedinUrl: row.linkedin_url });
    if (dryRun) preview[emailKey] = "will_update";
  }

  return {
    toUpdate,
    toCreate,
    preview,
    skipped,
    quotaBlocked,
  };
}

export async function getLinkedInImportCapacitySnapshot(
  organizationId: string,
  deps: LinkedInImportCapacityDeps,
): Promise<LinkedInImportCapacitySnapshot> {
  const [alumniLimit, enterpriseId] = await Promise.all([
    deps.getAlumniLimitForOrg(organizationId),
    deps.getEnterpriseIdForOrg(organizationId),
  ]);
  const currentAlumniCount = enterpriseId
    ? await deps.countAlumniForEnterprise(enterpriseId)
    : await deps.countAlumniForOrg(organizationId);

  return {
    alumniLimit,
    currentAlumniCount,
    remainingCapacity: alumniLimit === null ? Number.POSITIVE_INFINITY : alumniLimit - currentAlumniCount,
    scope: enterpriseId ? "enterprise" : "organization",
  };
}
