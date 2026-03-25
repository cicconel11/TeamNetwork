// ---------------------------------------------------------------------------
// Bright Data LinkedIn enrichment
// Docs: https://docs.brightdata.com/api-reference/web-scraper-api/social-media-apis/linkedin
// ---------------------------------------------------------------------------

import { isLinkedInProfileUrl } from "@/lib/alumni/linkedin-url";
import type { EnrichmentFields } from "./proxycurl";

/** A work experience entry from Bright Data LinkedIn profile. */
export interface BrightDataExperience {
  title: string | null;
  company: string | null;
  company_url: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
}

/** An education entry from Bright Data LinkedIn profile. */
export interface BrightDataEducation {
  school: string | null;
  degree: string | null;
  field_of_study: string | null;
  start_date: string | null;
  end_date: string | null;
}

/** The profile data returned by Bright Data LinkedIn Profiles API. */
export interface BrightDataProfileResult {
  linkedin_id: string | null;
  name: string | null;
  city: string | null;
  country_code: string | null;
  current_company_name: string | null;
  about: string | null;
  experience: BrightDataExperience[];
  education: BrightDataEducation[];
  avatar: string | null;
  followers: number | null;
  connections: number | null;
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
): Promise<BrightDataProfileResult | null> {
  const apiKey = getBrightDataApiKey();
  if (!apiKey) {
    console.log("[bright-data] Skipping enrichment — BRIGHT_DATA_API_KEY not configured");
    return null;
  }

  if (!linkedinUrl || !isLinkedInProfileUrl(linkedinUrl)) {
    console.warn("[bright-data] Invalid LinkedIn URL, skipping:", linkedinUrl);
    return null;
  }

  try {
    const res = await fetch(BRIGHT_DATA_PROFILES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: linkedinUrl }),
    });

    if (res.status === 400) {
      console.warn("[bright-data] Bad request for URL:", linkedinUrl);
      return null;
    }

    if (res.status === 401) {
      console.error("[bright-data] Unauthorized — check BRIGHT_DATA_API_KEY");
      return null;
    }

    if (res.status === 404) {
      console.warn("[bright-data] Profile not found for URL:", linkedinUrl);
      return null;
    }

    if (res.status === 429) {
      console.warn("[bright-data] Rate limited, skipping enrichment");
      return null;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[bright-data] API error:", res.status, body.substring(0, 200));
      return null;
    }

    const data = await res.json();
    return normalizeBrightDataResponse(data);
  } catch (err) {
    console.error("[bright-data] Network error:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Search profile by name + email (for members without a LinkedIn URL)
// ---------------------------------------------------------------------------

/**
 * Searches for a LinkedIn profile by name (and optionally email) using
 * Bright Data's discover-by-name feature.
 *
 * Returns the first matching profile or null if not found.
 * This is less accurate than URL-based lookup — used as a fallback
 * in the quarterly bulk cron for members without a LinkedIn URL.
 */
export async function searchBrightDataProfile(
  firstName: string,
  lastName: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  email?: string,
): Promise<BrightDataProfileResult | null> {
  const apiKey = getBrightDataApiKey();
  if (!apiKey) {
    console.log("[bright-data] Skipping search — BRIGHT_DATA_API_KEY not configured");
    return null;
  }

  if (!firstName || !lastName) {
    console.warn("[bright-data] Missing name for profile search");
    return null;
  }

  try {
    // Use synchronous scrape endpoint for single-profile discovery
    const res = await fetch("https://api.brightdata.com/datasets/v3/scrape?format=json", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: [{ first_name: firstName, last_name: lastName }],
        discover_by: "name",
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[bright-data] Search error:", res.status, body.substring(0, 200));
      return null;
    }

    const data = await res.json();
    // Response is an array — take the first result
    const first = Array.isArray(data) ? data[0] : data;
    if (!first) return null;

    return normalizeBrightDataResponse(first);
  } catch (err) {
    console.error("[bright-data] Search network error:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Normalize API response
// ---------------------------------------------------------------------------

function normalizeBrightDataResponse(data: Record<string, unknown>): BrightDataProfileResult {
  return {
    linkedin_id: (data.linkedin_id as string) || null,
    name: (data.name as string) || null,
    city: (data.city as string) || null,
    country_code: (data.country_code as string) || null,
    current_company_name: (data.current_company_name as string) || null,
    about: (data.about as string) || null,
    experience: Array.isArray(data.experience) ? data.experience : [],
    education: Array.isArray(data.education) ? data.education : [],
    avatar: (data.avatar as string) || null,
    followers: typeof data.followers === "number" ? data.followers : null,
    connections: typeof data.connections === "number" ? data.connections : null,
  };
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
 * Returns the same `EnrichmentFields` shape used by Proxycurl so both
 * providers feed the same `sync_user_linkedin_enrichment` RPC.
 */
export function mapBrightDataToFields(
  profile: BrightDataProfileResult,
): EnrichmentFields {
  const experiences = Array.isArray(profile.experience) ? profile.experience : [];
  const education = Array.isArray(profile.education) ? profile.education : [];

  // Find current job (no end date, most recent)
  const currentJob = experiences.find((e) => !e.end_date) ?? experiences[0] ?? null;

  // Most recent education
  const latestEdu = education[0] ?? null;

  return {
    job_title: currentJob?.title || null,
    current_company: profile.current_company_name || currentJob?.company || null,
    industry: null, // Bright Data doesn't return industry; leave as-is
    current_city: profile.city || currentJob?.location || null,
    school: latestEdu?.school || null,
    major: latestEdu?.field_of_study || null,
    position_title: currentJob?.title || null,
  };
}
