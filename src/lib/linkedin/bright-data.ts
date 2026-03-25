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
  company_id: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null; // "Present" for current jobs, date string for past, null if missing
  description_html: string | null;
  url: string | null;
  company_logo_url: string | null;
}

/** An education entry from Bright Data LinkedIn profile. */
export interface BrightDataEducation {
  title: string | null; // school name (NOT "school" — Bright Data uses "title")
  degree: string | null;
  field_of_study: string | null;
  url: string | null;
  start_year: string | null;
  end_year: string | null;
  description: string | null;
  description_html: string | null;
  institute_logo_url: string | null;
}

/** The profile fields we consume from Bright Data LinkedIn Profiles API. */
export interface BrightDataProfileResult {
  name: string | null;
  city: string | null;
  position: string | null; // headline/title
  about: string | null; // bio/summary
  current_company: string | null; // can be string or {name, title, ...} object
  current_company_name: string | null;
  experience: BrightDataExperience[];
  education: BrightDataEducation[];
  /** Summary string like "University of Michigan - School of Information" — fallback for school name */
  educations_details: string | null;
  /** Profile photo URL */
  avatar: string | null;
}

export type BrightDataFetchFailureKind =
  | "not_configured"
  | "invalid_url"
  | "unauthorized"
  | "provider_unavailable"
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

const BRIGHT_DATA_DATASET_ID = "gd_l1viktl72bvl7bjuj0";
// clean=1 bypasses Bright Data's cache so we always get the latest profile data
const BRIGHT_DATA_PROFILES_URL = `https://api.brightdata.com/datasets/v3/scrape?dataset_id=${BRIGHT_DATA_DATASET_ID}&format=json&clean=1`;

/**
 * Fetches a LinkedIn profile via Bright Data's Profiles API.
 *
 * Returns a typed success/failure result instead of throwing for
 * expected provider, validation, or configuration failures.
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
      body: JSON.stringify([{ url: linkedinUrl }]),
    });

    // 202 = sync timed out, Bright Data switched to async. Profile is still being collected.
    if (res.status === 202) {
      console.warn("[bright-data] Sync request timed out (202), profile still being collected");
      return {
        ok: false,
        kind: "upstream_error",
        error: "Profile is being collected. Try again in a few minutes.",
        upstreamStatus: 202,
      };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[bright-data] API error:", res.status, body.substring(0, 200));

      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          kind: "unauthorized",
          error: "Bright Data LinkedIn Profiles API is unavailable for the configured account.",
          upstreamStatus: res.status,
        };
      }

      if (res.status === 404) {
        return {
          ok: false,
          kind: "provider_unavailable",
          error: "Bright Data LinkedIn Profiles API is unavailable for the configured account.",
          upstreamStatus: res.status,
        };
      }

      return {
        ok: false,
        kind: "upstream_error",
        error: "Bright Data rejected the profile lookup.",
        upstreamStatus: res.status,
      };
    }

    const data = await res.json().catch(() => null);
    // Sync endpoint returns an array; take the first result
    const raw = Array.isArray(data) ? data[0] : data;
    const profile = normalizeBrightDataProfile(raw);
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
    (raw.current_company && typeof raw.current_company === "object") ||
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
    about: typeof raw.about === "string" ? raw.about : null,
    current_company: normalizeCurrentCompany(raw.current_company),
    current_company_name:
      typeof raw.current_company_name === "string" ? raw.current_company_name : null,
    // Bright Data may return experience as null (not just empty array) for private profiles
    experience: Array.isArray(raw.experience) ? raw.experience as BrightDataExperience[] : [],
    education: Array.isArray(raw.education) ? raw.education as BrightDataEducation[] : [],
    educations_details:
      typeof raw.educations_details === "string" ? raw.educations_details : null,
    avatar: typeof raw.avatar === "string" ? raw.avatar : null,
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

  // Current job: end_date is null, undefined, or "Present" for active roles
  const currentJob = experiences.find((e) => !e.end_date || e.end_date === "Present") ?? experiences[0] ?? null;
  const latestEdu = education[0] ?? null;
  const derivedCompany = profile.current_company || profile.current_company_name || currentJob?.company || null;
  const derivedTitle = currentJob?.title || profile.position || null;

  // Bright Data uses "title" for school name. If missing, fall back to
  // educations_details (a summary string like "University of Michigan - School of Information").
  const schoolName = latestEdu?.title || profile.educations_details || null;

  return {
    job_title: derivedTitle,
    current_company: derivedCompany,
    industry: null,
    current_city: profile.city || currentJob?.location || null,
    school: schoolName,
    // Try degree, then field_of_study (Bright Data may have either or neither)
    major: latestEdu?.degree || latestEdu?.field_of_study || null,
    position_title: derivedTitle,
  };
}
