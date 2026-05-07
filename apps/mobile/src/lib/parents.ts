export interface ParentRecord {
  id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone_number: string | null;
  photo_url: string | null;
  linkedin_url: string | null;
  student_name: string | null;
  relationship: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ParentInviteRecord {
  id: string;
  code: string;
  expires_at: string;
  status: string;
  created_at: string;
}

export interface ParentFormValues {
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  linkedin_url: string;
  student_name: string;
  relationship: string;
  notes: string;
}

export const PARENT_RELATIONSHIPS = [
  "Mother",
  "Father",
  "Guardian",
  "Stepmother",
  "Stepfather",
  "Grandparent",
  "Other",
] as const;

export const INITIAL_PARENT_FORM_VALUES: ParentFormValues = {
  first_name: "",
  last_name: "",
  email: "",
  phone_number: "",
  linkedin_url: "",
  student_name: "",
  relationship: "",
  notes: "",
};

function trimOptional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getParentDisplayName(parent: Pick<ParentRecord, "first_name" | "last_name" | "email">): string {
  const fullName = `${parent.first_name} ${parent.last_name}`.trim();
  return fullName || parent.email || "Unknown Parent";
}

export function getParentInitials(parent: Pick<ParentRecord, "first_name" | "last_name" | "email">): string {
  const first = parent.first_name.trim().charAt(0);
  const last = parent.last_name.trim().charAt(0);
  const initials = `${first}${last}`.trim();
  return initials ? initials.toUpperCase() : (parent.email?.charAt(0).toUpperCase() || "P");
}

export function validateParentForm(values: ParentFormValues): string | null {
  if (values.first_name.trim().length === 0) return "First name is required";
  if (values.last_name.trim().length === 0) return "Last name is required";

  const trimmedEmail = values.email.trim();
  if (trimmedEmail.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return "Enter a valid email address";
  }

  const linkedInValue = values.linkedin_url.trim();
  if (linkedInValue.length > 0 && !/^https:\/\/(www\.)?linkedin\.com\//i.test(linkedInValue)) {
    return "LinkedIn URL must start with https://linkedin.com/";
  }

  if (
    values.relationship.trim().length > 0 &&
    !PARENT_RELATIONSHIPS.includes(values.relationship.trim() as (typeof PARENT_RELATIONSHIPS)[number])
  ) {
    return "Select a valid relationship";
  }

  return null;
}

export function buildParentPayload(values: ParentFormValues) {
  return {
    first_name: values.first_name.trim(),
    last_name: values.last_name.trim(),
    email: trimOptional(values.email),
    phone_number: trimOptional(values.phone_number),
    linkedin_url: trimOptional(values.linkedin_url),
    student_name: trimOptional(values.student_name),
    relationship: trimOptional(values.relationship),
    notes: trimOptional(values.notes),
  };
}

export function toParentFormValues(parent: ParentRecord): ParentFormValues {
  return {
    first_name: parent.first_name || "",
    last_name: parent.last_name || "",
    email: parent.email || "",
    phone_number: parent.phone_number || "",
    linkedin_url: parent.linkedin_url || "",
    student_name: parent.student_name || "",
    relationship: parent.relationship || "",
    notes: parent.notes || "",
  };
}

export function buildParentInviteLink(orgId: string, inviteCode: string, baseUrl?: string): string {
  const envWebUrl =
    typeof process !== "undefined" ? process.env["EXPO_PUBLIC_WEB_URL"] : undefined;
  const resolvedBaseUrl = (
    baseUrl?.trim() ||
    envWebUrl?.trim() ||
    "https://www.myteamnetwork.com"
  ).replace(/\/+$/, "");
  const params = new URLSearchParams({
    org: orgId,
    code: inviteCode,
  });

  return `${resolvedBaseUrl}/app/parents-join?${params.toString()}`;
}

export function isParentInvitePending(invite: ParentInviteRecord): boolean {
  return invite.status === "pending" && new Date(invite.expires_at) > new Date();
}
