// ---------------------------------------------------------------------------
// Bright Data LinkedIn enrichment
// Docs: https://docs.brightdata.com/api-reference/web-scraper-api/social-media-apis/linkedin
// ---------------------------------------------------------------------------

import { isLinkedInProfileUrl } from "@/lib/alumni/linkedin-url";

/** Mapped fields ready to be written to member/alumni records. */
export interface EnrichmentFields {
  job_title: string | null;
  current_company: string | null;
  industry: string | null;
  current_city: string | null;
  school: string | null;
  major: string | null;
  position_title: string | null;
}

/** A work experience entry from Bright Data LinkedIn profile. */
export interface BrightDataExperience {
  title: string | null;
  company: string | null;
  location: string | null;
  end_date: string | null;
}

/** An education entry from Bright Data LinkedIn profile. */
export interface BrightDataEducation {
  school: string | null;
  field_of_study: string | null;
}

/** The profile fields we consume from Bright Data LinkedIn Profiles API. */
export interface BrightDataProfileResult {
  name: string | null;
  city: string | null;
  position: string | null;
  current_company: string | null;
  current_company_name: string | null;
  experience: BrightDataExperience[];
  education: BrightDataEducation[];
}

export type BrightDataFetchFailureKind =
  | "not_configured"
  | "invalid_url"
  | "upstream_error"
  | "malformed_payload"
  | "network_error";

export type BrightDataFetchResult =
  | { ok: true; profile: BrightDataProfileResult }
  | { ok: false; kind: BrightDataFetchFailureKind; error: string; upstreamStatus?: number };

interface FetchBrightDataProfileOptions {
  fetchFn?: typeof fetch;
}

// ---------------------------------------------------------------------------
// API key helper
// ---------------------------------------------------------------------------

function getBrightDataApiKey(): string | null {
  const key = process.env.BRIGHT_DATA_API_KEY;
  if (!key || key.trim() === "") return null;
  return key.trim();
}

export function isBrightDataConfigured(): boolean {
  return getBrightDataApiKey() !== null;
}

// ---------------------------------------------------------------------------
// Fetch profile by LinkedIn URL
// ---------------------------------------------------------------------------

const BRIGHT_DATA_PROFILES_URL = "https://api.brightdata.com/linkedin/profiles/collect";

/**
 * Fetches a LinkedIn profile via Bright Data's Profiles API.
 *
 * Returns null (rather than throwing) when the API key is missing,
 * the URL is invalid, or Bright Data returns a non-success response.
 */
export async function fetchBrightDataProfile(
  linkedinUrl: string,
  options: FetchBrightDataProfileOptions = {},
): Promise<BrightDataFetchResult> {
  const apiKey = getBrightDataApiKey();
  const fetchFn = options.fetchFn ?? fetch;

  if (!apiKey) {
    console.log("[bright-data] Skipping enrichment — BRIGHT_DATA_API_KEY not configured");
    return {
      ok: false,
      kind: "not_configured",
      error: "Bright Data is not configured.",
    };
  }

  if (!linkedinUrl || !isLinkedInProfileUrl(linkedinUrl)) {
    console.warn("[bright-data] Invalid LinkedIn URL, skipping");
    return {
      ok: false,
      kind: "invalid_url",
      error: "Invalid LinkedIn profile URL.",
    };
  }

  try {
    const res = await fetchFn(BRIGHT_DATA_PROFILES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: linkedinUrl }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[bright-data] API error:", res.status, body.substring(0, 200));
      return {
        ok: false,
        kind: "upstream_error",
        error: "Bright Data rejected the profile lookup.",
        upstreamStatus: res.status,
      };
    }

    const data = await res.json().catch(() => null);
    const profile = normalizeBrightDataProfile(data);
    if (!profile) {
      console.error("[bright-data] Malformed payload:", data);
      return {
        ok: false,
        kind: "malformed_payload",
        error: "Bright Data returned an unexpected profile payload.",
      };
    }

    return { ok: true, profile };
  } catch (err) {
    console.error("[bright-data] Network error:", err);
    return {
      ok: false,
      kind: "network_error",
      error: "Unable to reach Bright Data.",
    };
  }
}

function normalizeBrightDataProfile(data: unknown): BrightDataProfileResult | null {
  if (!data || typeof data !== "object") return null;

  const raw = data as Record<string, unknown>;
  const hasPrimaryIdentity =
    typeof raw.name === "string" ||
    typeof raw.position === "string" ||
    typeof raw.current_company === "string" ||
    typeof raw.current_company_name === "string" ||
    Array.isArray(raw.experience) ||
    Array.isArray(raw.education);

  if (!hasPrimaryIdentity) {
    return null;
  }

  return {
    name: typeof raw.name === "string" ? raw.name : null,
    city: typeof raw.city === "string" ? raw.city : null,
    position: typeof raw.position === "string" ? raw.position : null,
    current_company: normalizeCurrentCompany(raw.current_company),
    current_company_name:
      typeof raw.current_company_name === "string" ? raw.current_company_name : null,
    experience: Array.isArray(raw.experience) ? raw.experience as BrightDataExperience[] : [],
    education: Array.isArray(raw.education) ? raw.education as BrightDataEducation[] : [],
  };
}

function normalizeCurrentCompany(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "name" in value) {
    const name = (value as { name?: unknown }).name;
    return typeof name === "string" ? name : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Map Bright Data profile to DB fields
// ---------------------------------------------------------------------------

/**
 * Extracts DB-ready fields from a Bright Data profile.
 *
 * Current job = the most recent experience with no `end_date`.
 * School = the most recent education entry.
 *
 * Returns the `EnrichmentFields` shape that feeds the
 * `sync_user_linkedin_enrichment` RPC.
 */
export function mapBrightDataToFields(
  profile: BrightDataProfileResult,
): EnrichmentFields {
  const experiences = Array.isArray(profile.experience) ? profile.experience : [];
  const education = Array.isArray(profile.education) ? profile.education : [];

  const currentJob = experiences.find((e) => !e.end_date) ?? experiences[0] ?? null;
  const latestEdu = education[0] ?? null;
  const derivedCompany = profile.current_company || profile.current_company_name || currentJob?.company || null;
  const derivedTitle = currentJob?.title || profile.position || null;

  return {
    job_title: derivedTitle,
    current_company: derivedCompany,
    industry: null,
    current_city: profile.city || currentJob?.location || null,
    school: latestEdu?.school || null,
    major: latestEdu?.field_of_study || null,
    position_title: derivedTitle,
  };
}
