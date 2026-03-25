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
  current_company_name: string | null;
  experience: BrightDataExperience[];
  education: BrightDataEducation[];
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

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[bright-data] API error:", res.status, body.substring(0, 200));
      return null;
    }

    const data = await res.json();
    return {
      name: (data.name as string) || null,
      city: (data.city as string) || null,
      current_company_name: (data.current_company_name as string) || null,
      experience: Array.isArray(data.experience) ? data.experience : [],
      education: Array.isArray(data.education) ? data.education : [],
    };
  } catch (err) {
    console.error("[bright-data] Network error:", err);
    return null;
  }
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

  // Find current job (no end date, most recent)
  const currentJob = experiences.find((e) => !e.end_date) ?? experiences[0] ?? null;

  // Most recent education
  const latestEdu = education[0] ?? null;

  return {
    job_title: currentJob?.title || null,
    current_company: profile.current_company_name || currentJob?.company || null,
    industry: null,
    current_city: profile.city || currentJob?.location || null,
    school: latestEdu?.school || null,
    major: latestEdu?.field_of_study || null,
    position_title: currentJob?.title || null,
  };
}

// ---------------------------------------------------------------------------
// Bulk async API (trigger + poll + download)
// ---------------------------------------------------------------------------

const BRIGHT_DATA_DATASET_ID = "gd_l1viktl72bvl7bjuj0";
const BRIGHT_DATA_TRIGGER_URL = `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${BRIGHT_DATA_DATASET_ID}&format=json&uncompressed_webhook=true`;
const BRIGHT_DATA_PROGRESS_URL = "https://api.brightdata.com/datasets/v3/progress";
const BRIGHT_DATA_SNAPSHOT_URL = "https://api.brightdata.com/datasets/v3/snapshot";

export interface BrightDataTriggerResult {
  snapshot_id: string;
}

/**
 * Triggers an async bulk enrichment job for multiple LinkedIn URLs.
 * Returns a snapshot_id that can be polled for results.
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

export type BrightDataSnapshotStatus = "collecting" | "digesting" | "ready" | "failed";

/**
 * Checks the progress of an async enrichment job.
 */
export async function getSnapshotProgress(
  snapshotId: string,
): Promise<{ status: BrightDataSnapshotStatus } | null> {
  const apiKey = getBrightDataApiKey();
  if (!apiKey) return null;

  if (!/^[a-zA-Z0-9_-]+$/.test(snapshotId)) {
    console.error("[bright-data] Invalid snapshot_id format");
    return null;
  }

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

  if (!/^[a-zA-Z0-9_-]+$/.test(snapshotId)) {
    console.error("[bright-data] Invalid snapshot_id format");
    return null;
  }

  try {
    const res = await fetch(`${BRIGHT_DATA_SNAPSHOT_URL}/${snapshotId}?format=json`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (res.status === 202) return null; // still building

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[bright-data] Snapshot download error:", res.status, body.substring(0, 200));
      return null;
    }

    const data = await res.json();
    if (!Array.isArray(data)) return null;

    return data.map(normalizeBrightDataResponse);
  } catch (err) {
    console.error("[bright-data] Snapshot download network error:", err);
    return null;
  }
}
