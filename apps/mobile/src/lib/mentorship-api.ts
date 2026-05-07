import { fetchWithAuth } from "@/lib/web-api";
import type {
  MentorMatch,
  MentorProfilePayload,
  MentorProfileRecord,
  MentorProfileSuggestedDefaults,
} from "@/types/mentorship";

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let errorCode: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; error_code?: string };
      if (body?.error) message = body.error;
      if (body?.error_code) errorCode = body.error_code;
    } catch {
      // ignore
    }
    const err = new Error(message) as Error & { errorCode?: string; status?: number };
    err.errorCode = errorCode;
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export type MenteePreferences = {
  goals: string;
  seeking_mentorship: boolean;
  preferred_topics: string[];
  preferred_industries: string[];
  preferred_role_families: string[];
  preferred_sports: string[];
  preferred_positions: string[];
  required_attributes: string[];
  nice_to_have_attributes: string[];
  time_availability: "" | "1hr/month" | "2hr/month" | "4hr/month" | "flexible";
  communication_prefs: Array<"video" | "phone" | "in_person" | "async">;
  geographic_pref: string;
};

export const EMPTY_MENTEE_PREFERENCES: MenteePreferences = {
  goals: "",
  seeking_mentorship: false,
  preferred_topics: [],
  preferred_industries: [],
  preferred_role_families: [],
  preferred_sports: [],
  preferred_positions: [],
  required_attributes: [],
  nice_to_have_attributes: [],
  time_availability: "",
  communication_prefs: [],
  geographic_pref: "",
};

export type ProposalQueueRow = {
  id: string;
  status: string;
  mentor_user_id: string;
  mentee_user_id: string;
  proposed_at: string | null;
  match_score: number | null;
  match_signals: unknown;
  mentor_user: { id: string; name: string | null; email: string | null } | null;
  mentee_user: { id: string; name: string | null; email: string | null } | null;
  mentor: {
    user_id: string;
    bio: string | null;
    topics: string[] | null;
    expertise_areas: string[] | null;
    industries: string[] | null;
    role_families: string[] | null;
    sports: string[] | null;
    positions: string[] | null;
  } | null;
  mentee_preferences: {
    user_id: string;
    goals: string | null;
    preferred_topics: string[] | null;
    preferred_industries: string[] | null;
    preferred_role_families: string[] | null;
    required_attributes: string[] | null;
    time_availability: string | null;
  } | null;
};

function buildMentorProfileUrl(orgId: string, userId?: string) {
  const params = userId ? `?user_id=${encodeURIComponent(userId)}` : "";
  return `/api/organizations/${orgId}/mentorship/mentor-profile${params}`;
}

export type MentorshipTask = {
  id: string;
  pair_id: string;
  organization_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: "todo" | "in_progress" | "done";
  created_by: string;
  created_at: string;
  updated_at: string | null;
};

export type MentorshipMeeting = {
  id: string;
  pair_id: string;
  title: string;
  scheduled_at: string;
  scheduled_end_at: string | null;
  duration_minutes: number;
  platform: "zoom" | "google_meet" | "in_person" | "other";
  meeting_link: string | null;
  calendar_event_id: string | null;
  calendar_sync_status: "none" | "synced" | "failed" | null;
  created_by: string;
  created_at: string;
};

export async function requestMentor(orgId: string, mentorUserId: string) {
  const res = await fetchWithAuth(
    `/api/organizations/${orgId}/mentorship/requests`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mentor_user_id: mentorUserId }),
    }
  );
  return asJson<{ pair: Record<string, unknown>; reused?: boolean }>(res);
}

export async function getProposalQueue(orgId: string, sort: "score" | "proposed_at" | "mentee_name" = "score") {
  const res = await fetchWithAuth(
    `/api/organizations/${orgId}/mentorship/admin/queue?sort=${sort}`,
    { method: "GET" }
  );
  return asJson<{ queue: ProposalQueueRow[] }>(res);
}

export async function patchPair(
  orgId: string,
  pairId: string,
  body: { action: "accept" | "decline" | "override_approve"; reason?: string }
) {
  const res = await fetchWithAuth(
    `/api/organizations/${orgId}/mentorship/pairs/${pairId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return asJson<{ pair: Record<string, unknown> }>(res);
}

export async function remindMentor(orgId: string, mentorUserId: string) {
  const res = await fetchWithAuth(
    `/api/organizations/${orgId}/mentorship/admin/remind`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mentor_user_id: mentorUserId }),
    }
  );
  return asJson<{ sent: unknown[]; skipped: unknown[] }>(res);
}

export async function getPreferences(orgId: string) {
  const res = await fetchWithAuth(
    `/api/organizations/${orgId}/mentorship/preferences`,
    { method: "GET" }
  );
  return asJson<{ preferences: (Partial<MenteePreferences> & { id?: string }) | null }>(res);
}

export async function savePreferences(orgId: string, prefs: MenteePreferences) {
  const res = await fetchWithAuth(
    `/api/organizations/${orgId}/mentorship/preferences`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    }
  );
  return asJson<{ preferences: MenteePreferences }>(res);
}

export async function getMentorProfile(orgId: string, userId?: string) {
  const res = await fetchWithAuth(buildMentorProfileUrl(orgId, userId), {
    method: "GET",
  });
  return asJson<{
    profile: MentorProfileRecord | null;
    suggested?: MentorProfileSuggestedDefaults | null;
  }>(res);
}

export async function saveMentorProfile(
  orgId: string,
  payload: MentorProfilePayload,
  userId?: string
) {
  const res = await fetchWithAuth(buildMentorProfileUrl(orgId, userId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return asJson<{ profile: MentorProfileRecord }>(res);
}

export async function getMentorMatches(
  orgId: string,
  menteeUserId: string,
  options?: { limit?: number; focus_areas?: string[] }
) {
  const res = await fetchWithAuth(
    `/api/organizations/${orgId}/mentorship/suggestions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mentee_user_id: menteeUserId,
        limit: options?.limit,
        focus_areas: options?.focus_areas,
      }),
    }
  );
  const body = await asJson<{ matches?: unknown }>(res);
  return {
    matches: Array.isArray(body.matches) ? (body.matches as MentorMatch[]) : [],
  };
}

export async function getTasks(orgId: string, pairId: string) {
  const res = await fetchWithAuth(
    `/api/organizations/${orgId}/mentorship/tasks?pairId=${pairId}`,
    { method: "GET" }
  );
  return asJson<MentorshipTask[]>(res);
}

export async function createTask(
  orgId: string,
  payload: { pair_id: string; title: string; description?: string; due_date?: string; status?: "todo" | "in_progress" | "done" }
) {
  const res = await fetchWithAuth(
    `/api/organizations/${orgId}/mentorship/tasks`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  return asJson<{ task: MentorshipTask }>(res);
}

export async function updateTask(
  orgId: string,
  taskId: string,
  payload: { title?: string; description?: string | null; due_date?: string | null; status?: "todo" | "in_progress" | "done" }
) {
  const res = await fetchWithAuth(
    `/api/organizations/${orgId}/mentorship/tasks/${taskId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  return asJson<{ task: MentorshipTask }>(res);
}

export async function deleteTask(orgId: string, taskId: string) {
  const res = await fetchWithAuth(
    `/api/organizations/${orgId}/mentorship/tasks/${taskId}`,
    { method: "DELETE" }
  );
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete task (${res.status})`);
  }
}

export async function getMeetings(orgId: string, pairId: string) {
  const res = await fetchWithAuth(
    `/api/organizations/${orgId}/mentorship/meetings?pairId=${pairId}`,
    { method: "GET" }
  );
  return asJson<{ upcoming: MentorshipMeeting[]; past: MentorshipMeeting[] }>(res);
}

export async function createMeeting(
  orgId: string,
  payload: {
    pair_id: string;
    title: string;
    scheduled_at: string;
    duration_minutes: number;
    platform: "zoom" | "google_meet" | "in_person" | "other";
  }
) {
  const res = await fetchWithAuth(
    `/api/organizations/${orgId}/mentorship/meetings`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  return asJson<{ meeting: MentorshipMeeting; calendarInviteSent?: boolean; calendarError?: string }>(res);
}

export async function deleteMeeting(orgId: string, meetingId: string) {
  const res = await fetchWithAuth(
    `/api/organizations/${orgId}/mentorship/meetings/${meetingId}`,
    { method: "DELETE" }
  );
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete meeting (${res.status})`);
  }
}
