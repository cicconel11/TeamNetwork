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
