// ---------------------------------------------------------------------------
// Proxycurl LinkedIn enrichment
// Docs: https://nubela.co/proxycurl/docs
// ---------------------------------------------------------------------------

/** A single work experience entry from Proxycurl. */
export interface ProxycurlExperience {
  starts_at: { day: number; month: number; year: number } | null;
  ends_at: { day: number; month: number; year: number } | null;
  company: string | null;
  company_linkedin_profile_url: string | null;
  title: string | null;
  description: string | null;
  location: string | null;
}

/** A single education entry from Proxycurl. */
export interface ProxycurlEducation {
  starts_at: { day: number; month: number; year: number } | null;
  ends_at: { day: number; month: number; year: number } | null;
  school: string | null;
  school_linkedin_profile_url: string | null;
  degree_name: string | null;
  field_of_study: string | null;
}

/** The fields we extract from a Proxycurl person profile response. */
export interface ProxycurlEnrichmentResult {
  occupation: string | null;
  headline: string | null;
  summary: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  experiences: ProxycurlExperience[];
  education: ProxycurlEducation[];
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
}

// ---------------------------------------------------------------------------
// API key helper
// ---------------------------------------------------------------------------

function getProxycurlApiKey(): string | null {
  const key = process.env.PROXYCURL_API_KEY;
  if (!key || key.trim() === "") return null;
  return key.trim();
}

export function isProxycurlConfigured(): boolean {
  return getProxycurlApiKey() !== null;
}

// ---------------------------------------------------------------------------
// Fetch enrichment from Proxycurl
// ---------------------------------------------------------------------------

const PROXYCURL_PERSON_URL = "https://nubela.co/proxycurl/api/v2/linkedin";

/**
 * Fetches LinkedIn profile enrichment data via Proxycurl.
 *
 * Returns null (rather than throwing) when the API key is missing,
 * the URL is invalid, or Proxycurl returns a non-success response.
 */
export async function fetchLinkedInEnrichment(
  linkedinUrl: string,
): Promise<ProxycurlEnrichmentResult | null> {
  const apiKey = getProxycurlApiKey();
  if (!apiKey) {
    console.log("[proxycurl] Skipping enrichment — PROXYCURL_API_KEY not configured");
    return null;
  }

  if (!linkedinUrl || !linkedinUrl.includes("linkedin.com/in/")) {
    console.warn("[proxycurl] Invalid LinkedIn URL, skipping enrichment:", linkedinUrl);
    return null;
  }

  const params = new URLSearchParams({
    url: linkedinUrl,
    use_cache: "if-present",
  });

  try {
    const res = await fetch(`${PROXYCURL_PERSON_URL}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (res.status === 404) {
      console.warn("[proxycurl] Profile not found for URL:", linkedinUrl);
      return null;
    }

    if (res.status === 429) {
      console.warn("[proxycurl] Rate limited, skipping enrichment");
      return null;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[proxycurl] API error:", res.status, body.substring(0, 200));
      return null;
    }

    const data = await res.json();

    return {
      occupation: data.occupation || null,
      headline: data.headline || null,
      summary: data.summary || null,
      city: data.city || null,
      state: data.state || null,
      country: data.country || null,
      experiences: Array.isArray(data.experiences) ? data.experiences : [],
      education: Array.isArray(data.education) ? data.education : [],
    };
  } catch (err) {
    console.error("[proxycurl] Network error:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Map enrichment data to DB fields
// ---------------------------------------------------------------------------

/**
 * Extracts DB-ready fields from Proxycurl enrichment data.
 *
 * Current job = the most recent experience with no `ends_at`.
 * School = the most recent education entry.
 */
export function mapEnrichmentToFields(
  enrichment: ProxycurlEnrichmentResult,
): EnrichmentFields {
  // Find current job (no end date, most recent start)
  const currentJob = enrichment.experiences.find((e) => !e.ends_at) ?? enrichment.experiences[0] ?? null;

  // Most recent education
  const latestEdu = enrichment.education[0] ?? null;

  // Build location string
  const locationParts = [enrichment.city, enrichment.state].filter(Boolean);
  const currentCity = locationParts.length > 0 ? locationParts.join(", ") : null;

  return {
    job_title: currentJob?.title || enrichment.occupation || null,
    current_company: currentJob?.company || null,
    industry: null, // Proxycurl doesn't return industry at experience level; leave as-is
    current_city: currentCity,
    school: latestEdu?.school || null,
    major: latestEdu?.field_of_study || null,
    position_title: currentJob?.title || null,
  };
}
