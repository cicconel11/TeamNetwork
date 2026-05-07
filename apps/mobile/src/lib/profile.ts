import type { Database } from "@teammeet/types";
import { z } from "@teammeet/validation";
import { isValidLinkedInUrl } from "@/lib/url-safety";

type MemberRow = Database["public"]["Tables"]["members"]["Row"];
type AlumniRow = Database["public"]["Tables"]["alumni"]["Row"];
type ParentRow = Database["public"]["Tables"]["parents"]["Row"];

export type EditableProfileRole = "member" | "alumni" | "parent";

export interface ProfileOrganization {
  id: string;
  slug: string;
  name?: string | null;
}

export interface ProfileFormValues {
  first_name: string;
  last_name: string;
  email: string;
  graduation_year: string;
  expected_graduation_date: string;
  major: string;
  job_title: string;
  position_title: string;
  current_company: string;
  industry: string;
  current_city: string;
  phone_number: string;
  linkedin_url: string;
  notes: string;
  student_name: string;
  relationship: string;
}

export const INITIAL_PROFILE_FORM_VALUES: ProfileFormValues = {
  first_name: "",
  last_name: "",
  email: "",
  graduation_year: "",
  expected_graduation_date: "",
  major: "",
  job_title: "",
  position_title: "",
  current_company: "",
  industry: "",
  current_city: "",
  phone_number: "",
  linkedin_url: "",
  notes: "",
  student_name: "",
  relationship: "",
};

export function toEditableProfileRole(role: string | null | undefined): EditableProfileRole | null {
  if (!role) return null;
  if (role === "admin" || role === "active_member" || role === "member") {
    return "member";
  }
  if (role === "alumni" || role === "viewer") {
    return "alumni";
  }
  if (role === "parent") {
    return "parent";
  }
  return null;
}

export function getEditableProfileRoleLabel(role: EditableProfileRole): string {
  if (role === "member") return "Member profile";
  if (role === "alumni") return "Alumni profile";
  return "Parent profile";
}

export function resolveProfileOrganization(
  organizations: ProfileOrganization[],
  routeSlug?: string | null,
  selectedSlug?: string | null
): ProfileOrganization | null {
  const desiredSlug = routeSlug ?? selectedSlug ?? null;
  if (desiredSlug) {
    return organizations.find((organization) => organization.slug === desiredSlug) ?? null;
  }
  if (organizations.length === 1) {
    return organizations[0] ?? null;
  }
  return null;
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function parseGraduationYear(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number.parseInt(trimmed, 10);
}

function splitName(value: string | null | undefined): { firstName: string; lastName: string } {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return { firstName: "", lastName: "" };
  }

  const parts = trimmed.split(/\s+/);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

function inferNameFallback(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  metadataName: string | null | undefined,
  email: string | null | undefined
) {
  const metadataParts = splitName(metadataName);
  return {
    firstName: firstName?.trim() || metadataParts.firstName || email?.split("@")[0] || "",
    lastName: lastName?.trim() || metadataParts.lastName || "",
  };
}

export function buildProfileFormValues(
  role: EditableProfileRole,
  row: MemberRow | AlumniRow | ParentRow,
  authUser?: {
    email?: string | null;
    user_metadata?: {
      name?: string;
      first_name?: string;
      last_name?: string;
    } | null;
  } | null
): ProfileFormValues {
  const metadata = authUser?.user_metadata ?? {};

  if (role === "member") {
    const member = row as MemberRow;
    const fallback = inferNameFallback(
      member.first_name,
      member.last_name,
      metadata.name ?? [metadata.first_name, metadata.last_name].filter(Boolean).join(" "),
      authUser?.email
    );

    return {
      ...INITIAL_PROFILE_FORM_VALUES,
      first_name: member.first_name || fallback.firstName,
      last_name: member.last_name || fallback.lastName,
      email: member.email || authUser?.email || "",
      graduation_year: member.graduation_year != null ? String(member.graduation_year) : "",
      expected_graduation_date: member.expected_graduation_date || "",
      linkedin_url: member.linkedin_url || "",
    };
  }

  if (role === "alumni") {
    const alumni = row as AlumniRow;
    const fallback = inferNameFallback(
      alumni.first_name,
      alumni.last_name,
      metadata.name ?? [metadata.first_name, metadata.last_name].filter(Boolean).join(" "),
      authUser?.email
    );

    return {
      ...INITIAL_PROFILE_FORM_VALUES,
      first_name: alumni.first_name || fallback.firstName,
      last_name: alumni.last_name || fallback.lastName,
      email: alumni.email || authUser?.email || "",
      graduation_year: alumni.graduation_year != null ? String(alumni.graduation_year) : "",
      major: alumni.major || "",
      job_title: alumni.job_title || "",
      position_title: alumni.position_title || "",
      current_company: alumni.current_company || "",
      industry: alumni.industry || "",
      current_city: alumni.current_city || "",
      phone_number: alumni.phone_number || "",
      linkedin_url: alumni.linkedin_url || "",
      notes: alumni.notes || "",
      expected_graduation_date: "",
      student_name: "",
      relationship: "",
    };
  }

  const parent = row as ParentRow;
  const fallback = inferNameFallback(
    parent.first_name,
    parent.last_name,
    metadata.name ?? [metadata.first_name, metadata.last_name].filter(Boolean).join(" "),
    authUser?.email
  );

  return {
    ...INITIAL_PROFILE_FORM_VALUES,
    first_name: parent.first_name || fallback.firstName,
    last_name: parent.last_name || fallback.lastName,
    email: parent.email || authUser?.email || "",
    phone_number: parent.phone_number || "",
    linkedin_url: parent.linkedin_url || "",
    notes: parent.notes || "",
    student_name: parent.student_name || "",
    relationship: parent.relationship || "",
  };
}

const linkedInField = z
  .string()
  .trim()
  .max(500, "LinkedIn URL must be 500 characters or less")
  .refine(
    (value) => value.length === 0 || isValidLinkedInUrl(value),
    "Please enter a valid LinkedIn profile URL using https://linkedin.com/..."
  );

const graduationYearField = z
  .string()
  .trim()
  .refine((value) => value.length === 0 || /^\d{4}$/.test(value), "Graduation year must be 4 digits")
  .refine((value) => {
    if (!value.length) return true;
    const parsed = Number.parseInt(value, 10);
    return parsed >= 1900 && parsed <= 2100;
  }, "Graduation year must be between 1900 and 2100");

const dateField = z
  .string()
  .trim()
  .refine((value) => value.length === 0 || /^\d{4}-\d{2}-\d{2}$/.test(value), "Use YYYY-MM-DD");

const sharedSchema = z.object({
  first_name: z.string().trim().min(1, "First name is required").max(100, "First name is too long"),
  last_name: z.string().trim().min(1, "Last name is required").max(100, "Last name is too long"),
  email: z.string(),
  graduation_year: graduationYearField,
  expected_graduation_date: dateField,
  major: z.string().trim().max(200, "Major is too long"),
  job_title: z.string().trim().max(200, "Job title is too long"),
  position_title: z.string().trim().max(200, "Position title is too long"),
  current_company: z.string().trim().max(200, "Company is too long"),
  industry: z.string().trim().max(200, "Industry is too long"),
  current_city: z.string().trim().max(200, "City is too long"),
  phone_number: z.string().trim().max(50, "Phone number is too long"),
  linkedin_url: linkedInField,
  notes: z.string().trim().max(2000, "Notes must be 2000 characters or less"),
  student_name: z.string().trim().max(200, "Student name is too long"),
  relationship: z.string().trim().max(100, "Relationship is too long"),
});

const memberSchema = sharedSchema.pick({
  first_name: true,
  last_name: true,
  email: true,
  graduation_year: true,
  expected_graduation_date: true,
  linkedin_url: true,
  major: true,
  job_title: true,
  position_title: true,
  current_company: true,
  industry: true,
  current_city: true,
  phone_number: true,
  notes: true,
  student_name: true,
  relationship: true,
});

const alumniSchema = sharedSchema;

const parentSchema = sharedSchema.pick({
  first_name: true,
  last_name: true,
  email: true,
  phone_number: true,
  linkedin_url: true,
  notes: true,
  student_name: true,
  relationship: true,
  graduation_year: true,
  expected_graduation_date: true,
  major: true,
  job_title: true,
  position_title: true,
  current_company: true,
  industry: true,
  current_city: true,
});

export function validateProfileForm(role: EditableProfileRole, values: ProfileFormValues) {
  if (role === "member") return memberSchema.safeParse(values);
  if (role === "alumni") return alumniSchema.safeParse(values);
  return parentSchema.safeParse(values);
}

export function buildAuthMetadataUpdate(
  values: Pick<ProfileFormValues, "first_name" | "last_name">,
  avatarUrl?: string | null
) {
  const firstName = values.first_name.trim();
  const lastName = values.last_name.trim();

  return {
    first_name: firstName,
    last_name: lastName,
    name: [firstName, lastName].filter(Boolean).join(" ").trim(),
    ...(avatarUrl !== undefined ? { avatar_url: avatarUrl } : {}),
  };
}

export function buildMemberProfileUpdate(
  values: ProfileFormValues,
  avatarUrl: string | null
): Database["public"]["Tables"]["members"]["Update"] {
  return {
    first_name: values.first_name.trim(),
    last_name: values.last_name.trim(),
    graduation_year: parseGraduationYear(values.graduation_year),
    expected_graduation_date: trimOrNull(values.expected_graduation_date),
    linkedin_url: trimOrNull(values.linkedin_url),
    photo_url: avatarUrl,
    updated_at: new Date().toISOString(),
  };
}

export function buildAlumniProfileUpdate(
  values: ProfileFormValues,
  avatarUrl: string | null
): Database["public"]["Tables"]["alumni"]["Update"] {
  return {
    first_name: values.first_name.trim(),
    last_name: values.last_name.trim(),
    graduation_year: parseGraduationYear(values.graduation_year),
    major: trimOrNull(values.major),
    job_title: trimOrNull(values.job_title),
    position_title: trimOrNull(values.position_title),
    current_company: trimOrNull(values.current_company),
    industry: trimOrNull(values.industry),
    current_city: trimOrNull(values.current_city),
    phone_number: trimOrNull(values.phone_number),
    linkedin_url: trimOrNull(values.linkedin_url),
    notes: trimOrNull(values.notes),
    photo_url: avatarUrl,
    updated_at: new Date().toISOString(),
  };
}

export function buildParentProfileUpdate(
  values: ProfileFormValues,
  avatarUrl: string | null
): Database["public"]["Tables"]["parents"]["Update"] {
  return {
    first_name: values.first_name.trim(),
    last_name: values.last_name.trim(),
    phone_number: trimOrNull(values.phone_number),
    linkedin_url: trimOrNull(values.linkedin_url),
    notes: trimOrNull(values.notes),
    student_name: trimOrNull(values.student_name),
    relationship: trimOrNull(values.relationship),
    photo_url: avatarUrl,
    updated_at: new Date().toISOString(),
  };
}
