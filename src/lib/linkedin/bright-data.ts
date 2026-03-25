// ---------------------------------------------------------------------------
// Bright Data LinkedIn enrichment
// Docs: https://docs.brightdata.com/api-reference/web-scraper-api/social-media-apis/linkedin
// ---------------------------------------------------------------------------

import { isLinkedInProfileUrl } from "@/lib/alumni/linkedin-url";

// ---------------------------------------------------------------------------
// Bright Data response types
// ---------------------------------------------------------------------------

/** A single work experience entry from Bright Data. */
export interface BrightDataExperience {
  title: string | null;
  company: string | null;
  description: string | null;
  description_html: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  duration: string | null;
  duration_short: string | null;
  url: string | null;
  company_logo_url: string | null;
  company_id: string | null;
}

/** A single education entry from Bright Data. */
export interface BrightDataEducation {
  title: string | null;
  degree: string | null;
  field: string | null;
  start_year: string | null;
  end_year: string | null;
  description: string | null;
  description_html: string | null;
  url: string | null;
  institute_logo_url: string | null;
}

/** The full profile response from Bright Data's LinkedIn Profiles scraper. */
export interface BrightDataProfileResult {
  id: string | null;
  name: string | null;
  position: string | null;
  about: string | null;
  city: string | null;
  country_code: string | null;
  location: string | null;
  current_company_name: string | null;
  current_company: {
    name: string | null;
    title: string | null;
    link: string | null;
    company_id: string | null;
  } | null;
  avatar: string | null;
  url: string | null;
  input_url: string | null;
  followers: number | null;
  connections: number | null;
  experience: BrightDataExperience[];
  education: BrightDataEducation[];
  recommendations_count: number | null;
  timestamp: string | null;
}

/** Mapped fields ready to be written to member/alumni records. */
export interface EnrichmentFields {
  job_title: string | null;
  current_company: string | null;
  industry: string | null;
  current_city: string | null;
  school: string | null;
  major: string | null;
  position_title: string | null;
  headline: string | null;
  summary: string | null;
  work_history: BrightDataExperience[];
  education_history: BrightDataEducation[];
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
// Bright Data API constants
// ---------------------------------------------------------------------------

const BRIGHT_DATA_DATASET_ID = "gd_l1viktl72bvl7bjuj0";
const BRIGHT_DATA_SCRAPE_URL = `https://api.brightdata.com/datasets/v3/scrape?dataset_id=${BRIGHT_DATA_DATASET_ID}&format=json`;
const BRIGHT_DATA_TRIGGER_URL = `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${BRIGHT_DATA_DATASET_ID}&format=json&uncompressed_webhook=true`;
const BRIGHT_DATA_PROGRESS_URL = "https://api.brightdata.com/datasets/v3/progress";
const BRIGHT_DATA_SNAPSHOT_URL = "https://api.brightdata.com/datasets/v3/snapshot";

// ---------------------------------------------------------------------------
// Fetch single profile (sync endpoint)
// ---------------------------------------------------------------------------

/**
 * Fetches LinkedIn profile enrichment data via Bright Data's sync endpoint.
 *
 * Returns null (rather than throwing) when the API key is missing,
 * the URL is invalid, or Bright Data returns a non-success response.
 */
export async function fetchLinkedInEnrichment(
  linkedinUrl: string,
): Promise<BrightDataProfileResult | null> {
  const apiKey = getBrightDataApiKey();
  if (!apiKey) {
    console.log("[bright-data] Skipping enrichment — BRIGHT_DATA_API_KEY not configured");
    return null;
  }

  if (!linkedinUrl || !isLinkedInProfileUrl(linkedinUrl)) {
    console.warn("[bright-data] Invalid LinkedIn URL, skipping enrichment:", linkedinUrl);
    return null;
  }

  try {
    const res = await fetch(BRIGHT_DATA_SCRAPE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{ url: linkedinUrl }]),
    });

    if (res.status === 404) {
      console.warn("[bright-data] Profile not found for URL:", linkedinUrl);
      return null;
    }

    if (res.status === 429) {
      console.warn("[bright-data] Rate limited, skipping enrichment");
      return null;
    }

    // 202 means timeout — Bright Data switched to async mode
    if (res.status === 202) {
      console.warn("[bright-data] Sync request timed out (202), skipping for now");
      return null;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[bright-data] API error:", res.status, body.substring(0, 200));
      return null;
    }

    const data = await res.json();

    // Sync endpoint returns an array; take the first result
    const profile = Array.isArray(data) ? data[0] : data;
    if (!profile) return null;

    return normalizeProfileResult(profile);
  } catch (err) {
    console.error("[bright-data] Network error:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Bulk trigger (async endpoint)
// ---------------------------------------------------------------------------

export interface BrightDataTriggerResult {
  snapshot_id: string;
}

/**
 * Triggers an async bulk enrichment job for multiple LinkedIn URLs.
 * Returns a snapshot_id that can be used to poll for results.
 */
export async function triggerBulkEnrichment(
  linkedinUrls: string[],
): Promise<BrightDataTriggerResult | null> {
  const apiKey = getBrightDataApiKey();
  if (!apiKey) {
    console.log("[bright-data] Skipping bulk enrichment — BRIGHT_DATA_API_KEY not configured");
    return null;
  }

  const validUrls = linkedinUrls.filter((url) => url && isLinkedInProfileUrl(url));
  if (validUrls.length === 0) {
    console.warn("[bright-data] No valid LinkedIn URLs for bulk enrichment");
    return null;
  }

  try {
    const res = await fetch(BRIGHT_DATA_TRIGGER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validUrls.map((url) => ({ url }))),
    });

    if (res.status === 429) {
      console.warn("[bright-data] Rate limited on bulk trigger");
      return null;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[bright-data] Bulk trigger error:", res.status, body.substring(0, 200));
      return null;
    }

    const data = await res.json();
    if (!data?.snapshot_id) {
      console.error("[bright-data] No snapshot_id in trigger response");
      return null;
    }

    return { snapshot_id: data.snapshot_id };
  } catch (err) {
    console.error("[bright-data] Bulk trigger network error:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Poll for async results
// ---------------------------------------------------------------------------

export type BrightDataSnapshotStatus = "collecting" | "digesting" | "ready" | "failed";

export interface BrightDataProgressResult {
  status: BrightDataSnapshotStatus;
}

/**
 * Checks the progress of an async enrichment job.
 */
export async function getSnapshotProgress(
  snapshotId: string,
): Promise<BrightDataProgressResult | null> {
  const apiKey = getBrightDataApiKey();
  if (!apiKey) return null;

  try {
    const res = await fetch(`${BRIGHT_DATA_PROGRESS_URL}/${snapshotId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      console.error("[bright-data] Progress check error:", res.status);
      return null;
    }

    const data = await res.json();
    return { status: data.status as BrightDataSnapshotStatus };
  } catch (err) {
    console.error("[bright-data] Progress check network error:", err);
    return null;
  }
}

/**
 * Downloads the results of a completed async enrichment job.
 */
export async function getSnapshotResults(
  snapshotId: string,
): Promise<BrightDataProfileResult[] | null> {
  const apiKey = getBrightDataApiKey();
  if (!apiKey) return null;

  try {
    const res = await fetch(`${BRIGHT_DATA_SNAPSHOT_URL}/${snapshotId}?format=json`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    // 202 = still building
    if (res.status === 202) {
      return null;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[bright-data] Snapshot download error:", res.status, body.substring(0, 200));
      return null;
    }

    const data = await res.json();
    if (!Array.isArray(data)) return null;

    return data.map(normalizeProfileResult);
  } catch (err) {
    console.error("[bright-data] Snapshot download network error:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Normalize raw Bright Data response
// ---------------------------------------------------------------------------

function normalizeProfileResult(raw: Record<string, unknown>): BrightDataProfileResult {
  const currentCompany = raw.current_company as BrightDataProfileResult["current_company"];

  return {
    id: (raw.id as string) || null,
    name: (raw.name as string) || null,
    position: (raw.position as string) || null,
    about: (raw.about as string) || null,
    city: (raw.city as string) || null,
    country_code: (raw.country_code as string) || null,
    location: (raw.location as string) || null,
    current_company_name: (raw.current_company_name as string) || null,
    current_company: currentCompany || null,
    avatar: (raw.avatar as string) || null,
    url: (raw.url as string) || null,
    input_url: (raw.input_url as string) || null,
    followers: typeof raw.followers === "number" ? raw.followers : null,
    connections: typeof raw.connections === "number" ? raw.connections : null,
    experience: Array.isArray(raw.experience) ? raw.experience : [],
    education: Array.isArray(raw.education) ? raw.education : [],
    recommendations_count: typeof raw.recommendations_count === "number" ? raw.recommendations_count : null,
    timestamp: (raw.timestamp as string) || null,
  };
}

// ---------------------------------------------------------------------------
// Map enrichment data to DB fields
// ---------------------------------------------------------------------------

/**
 * Extracts DB-ready fields from Bright Data enrichment data.
 *
 * Current job = the most recent experience with no `end_date`.
 * School = the most recent education entry.
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

  // Build location string
  const currentCity = profile.city || profile.location || null;

  // Current company: prefer current_company object, fall back to current_company_name
  const companyName =
    profile.current_company?.name ||
    profile.current_company_name ||
    currentJob?.company ||
    null;

  return {
    job_title: currentJob?.title || profile.position || null,
    current_company: companyName,
    industry: null, // Not reliably available from Bright Data
    current_city: currentCity,
    school: latestEdu?.title || null,
    major: latestEdu?.field || null,
    position_title: currentJob?.title || null,
    headline: profile.position || null,
    summary: profile.about || null,
    work_history: experiences,
    education_history: education,
  };
}
