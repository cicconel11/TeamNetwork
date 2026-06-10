import type { EditAlumniForm, NewAlumniForm } from "@/lib/schemas/member";

export type AlumniMutationAction = "create" | "update" | "delete";

type AllowedMutation = { allowed: true };
type DeniedMutation = {
  allowed: false;
  status: 403;
  error: string;
  code?: "ORG_READ_ONLY";
};

export type AlumniMutationDecision = AllowedMutation | DeniedMutation;

type AlumniWriteInput = NewAlumniForm | EditAlumniForm;

export function canMutateAlumni(params: {
  action: AlumniMutationAction;
  isReadOnly: boolean;
  isAdmin: boolean;
  isSelf: boolean;
}): AlumniMutationDecision {
  const { action, isReadOnly, isAdmin, isSelf } = params;

  if (action === "create") {
    if (!isAdmin) {
      return {
        allowed: false,
        status: 403,
        error: "Forbidden",
      };
    }
    return { allowed: true };
  }

  if (isReadOnly) {
    return {
      allowed: false,
      status: 403,
      error: "Organization is in read-only mode. Please resubscribe to make changes.",
      code: "ORG_READ_ONLY",
    };
  }

  if (action === "update") {
    if (isAdmin || isSelf) {
      return { allowed: true };
    }

    return {
      allowed: false,
      status: 403,
      error: "Forbidden",
    };
  }

  if (isAdmin) {
    return { allowed: true };
  }

  return {
    allowed: false,
    status: 403,
    error: "Forbidden",
  };
}

/**
 * Alumni columns that are BOTH written by the LinkedIn enrichment RPCs
 * (see migration 20261219000000_alumni_enrichment_provenance.sql) AND
 * editable through the alumni edit form's PATCH payload. Only these can
 * gain a "Filled from LinkedIn" chip or be stripped from provenance by a
 * human edit.
 */
export const ENRICHMENT_PROVENANCE_FIELDS = [
  "job_title",
  "position_title",
  "current_company",
  "current_city",
  "major",
  "industry",
  "photo_url",
] as const;

function normalizeForProvenanceCompare(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  return value ?? null;
}

/**
 * D11 consumer-side strip: given the pre-update alumni row, the PATCH write
 * payload, and the row's enrichment_filled_fields, return the provenance keys
 * the edit actually CHANGED (trim-compared for strings). Identical round-trip
 * values strip nothing; a null/empty provenance list is a no-op.
 */
export function computeProvenanceStrip(
  existingRow: Record<string, unknown>,
  patchPayload: Record<string, unknown>,
  filledFields: string[] | null | undefined,
): string[] {
  if (!filledFields || filledFields.length === 0) return [];
  return ENRICHMENT_PROVENANCE_FIELDS.filter((field) => {
    if (!filledFields.includes(field)) return false;
    if (!(field in patchPayload)) return false;
    return (
      normalizeForProvenanceCompare(patchPayload[field]) !==
      normalizeForProvenanceCompare(existingRow[field])
    );
  });
}

export function buildAlumniWritePayload(data: AlumniWriteInput) {
  return {
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email || null,
    graduation_year: data.graduation_year ? parseInt(data.graduation_year, 10) : null,
    birth_year: data.birth_year ? parseInt(data.birth_year, 10) : null,
    major: data.major || null,
    job_title: data.job_title || null,
    photo_url: data.photo_url || null,
    notes: data.notes || null,
    linkedin_url: data.linkedin_url || null,
    phone_number: data.phone_number || null,
    industry: data.industry || null,
    current_company: data.current_company || null,
    current_city: data.current_city || null,
    position_title: data.position_title || null,
  };
}
