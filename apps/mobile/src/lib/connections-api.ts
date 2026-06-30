import { fetchWithAuth } from "@/lib/web-api";

export type ConnectionPersonType = "member" | "alumni" | "parent";
export type ConnectionMatchStrength = "strong" | "good" | "suggested";
export type ConnectionReasonCode =
  | "shared_company"
  | "shared_industry"
  | "shared_role_family"
  | "shared_city"
  | "graduation_proximity";

export interface DisplayReadyConnectionReason {
  code: ConnectionReasonCode;
  weight: number;
  value?: string | number;
  label: string;
  detail: string | null;
  strong: boolean;
}

export interface DisplayReadySuggestedConnection {
  person_type: ConnectionPersonType;
  person_id: string;
  name: string;
  subtitle: string | null;
  messageable: boolean;
  score: number;
  strength: ConnectionMatchStrength;
  preview: {
    role?: string;
    major?: string;
    current_company?: string;
    industry?: string;
    graduation_year?: number;
    current_city?: string;
  };
  reasons: DisplayReadyConnectionReason[];
}

export type ConnectionSuggestionsState = "ok" | "no_source";

export interface ConnectionSuggestionsResult {
  state: ConnectionSuggestionsState;
  suggestions: DisplayReadySuggestedConnection[];
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: string | undefined;

    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body?.error) message = body.error;
      if (body?.code) code = body.code;
    } catch {
      // Keep the status-derived message when the body is not JSON.
    }

    const error = new Error(message) as Error & { status?: number; code?: string };
    error.status = res.status;
    error.code = code;
    throw error;
  }

  return (await res.json()) as T;
}

export async function getConnectionSuggestions(
  orgId: string
): Promise<ConnectionSuggestionsResult> {
  const res = await fetchWithAuth(
    `/api/organizations/${orgId}/connections/suggestions`,
    { method: "GET" }
  );
  return asJson<ConnectionSuggestionsResult>(res);
}

export async function startConnectionChat(input: {
  orgId: string;
  profileType: ConnectionPersonType;
  profileId: string;
}) {
  const res = await fetchWithAuth(
    `/api/organizations/${input.orgId}/direct-chat/profile`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileType: input.profileType,
        profileId: input.profileId,
      }),
    }
  );
  return asJson<{ chatGroupId: string; reused?: boolean }>(res);
}
