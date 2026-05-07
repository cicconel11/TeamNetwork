export type SelectOption = { value: string; label: string };

export type MentorshipStatus = "active" | "paused" | "completed";

export type MentorDirectoryEntry = {
  id: string;
  user_id: string;
  name: string;
  email: string | null;
  photo_url: string | null;
  industry: string | null;
  graduation_year: number | null;
  current_company: string | null;
  current_city: string | null;
  expertise_areas: string[] | null;
  topics: string[] | null;
  sports: string[] | null;
  positions: string[] | null;
  industries: string[] | null;
  role_families: string[] | null;
  bio: string | null;
  contact_email: string | null;
  contact_linkedin: string | null;
  contact_phone: string | null;
  accepting_new: boolean;
  max_mentees: number;
  current_mentee_count: number;
  meeting_preferences: string[] | null;
  time_commitment: string | null;
  years_of_experience: number | null;
};

export type MentorProfileRecord = {
  id: string;
  bio: string | null;
  expertise_areas: string[];
  topics: string[];
  sports: string[];
  positions: string[];
  industries: string[];
  role_families: string[];
  contact_email?: string | null;
  contact_linkedin?: string | null;
  contact_phone?: string | null;
  is_active: boolean;
  organization_id: string;
  user_id: string;
  max_mentees: number;
  accepting_new: boolean;
  meeting_preferences: Array<"video" | "phone" | "in_person" | "async">;
  time_commitment: string | null;
  years_of_experience: number | null;
};

export type MentorProfileSuggestedDefaults = {
  bio: string | null;
  industries: string[];
  role_families: string[];
  positions: string[];
};

export type MentorProfilePayload = {
  bio: string;
  expertise_areas: string[];
  topics: string[];
  sports: string[];
  positions: string[];
  industries: string[];
  role_families: string[];
  max_mentees: number;
  accepting_new: boolean;
  meeting_preferences: Array<"video" | "phone" | "in_person" | "async">;
  time_commitment: string;
  years_of_experience: number | null;
};

export type MentorMatchSignal = {
  code: string;
  label: string;
  weight: number;
  value?: string | number;
};

export type MentorMatchReason = {
  code: string;
  label: string;
};

export type MentorMatch = {
  mentorUserId: string;
  score: number;
  signals: MentorMatchSignal[];
  reasons: MentorMatchReason[];
  mentor: {
    user_id: string;
    name: string;
    subtitle: string | null;
  };
};

export const STATUS_OPTIONS: SelectOption[] = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
];
