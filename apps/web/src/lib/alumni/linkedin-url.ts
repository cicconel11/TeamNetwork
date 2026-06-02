import { z } from "zod";

const LINKEDIN_PROFILE_PATH = /^\/in\/[a-z0-9_-]+$/;

/** Matches a `*.linkedin.com` host (with a leading locale/country/sub label). */
const LINKEDIN_SUBDOMAIN_HOST = /^[a-z0-9-]+\.linkedin\.com$/;

/**
 * Canonicalizes a LinkedIn profile URL to a single matching key.
 *
 * This value is the join key between a stored alumni/user `linkedin_url` and the
 * URL the Apify scraper echoes back, so cosmetic differences that denote the
 * SAME profile must collapse to one string — otherwise the scraped profile is
 * dropped and the row fails with `no_matching_profile` (the sole cause of every
 * production enrichment failure observed). We therefore:
 *   - upgrade http -> https
 *   - lowercase the host and collapse any `*.linkedin.com` locale subdomain
 *     (e.g. `de.linkedin.com`) to `www.linkedin.com`
 *   - lowercase the `/in/<slug>` path (slugs are case-insensitive on LinkedIn)
 *   - drop the query string and fragment (tracking params like `?trk=...`)
 *   - strip the trailing slash
 *
 * Genuinely different slugs stay distinct. On a non-URL input we return the
 * trimmed original (callers treat that as "not a valid profile URL").
 */
export function normalizeLinkedInProfileUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  try {
    const url = new URL(trimmed);

    if (url.protocol === "http:") {
      url.protocol = "https:";
    }

    const host = url.hostname.toLowerCase();
    url.hostname =
      host === "linkedin.com" || LINKEDIN_SUBDOMAIN_HOST.test(host)
        ? "www.linkedin.com"
        : host;

    url.pathname = url.pathname.toLowerCase().replace(/\/+$/, "");
    url.search = "";
    url.hash = "";

    return url.toString();
  } catch {
    return trimmed;
  }
}

export function isLinkedInProfileUrl(value: string): boolean {
  if (!value) return false;

  try {
    const normalized = normalizeLinkedInProfileUrl(value);
    const url = new URL(normalized);

    return (
      url.protocol === "https:" &&
      url.hostname === "www.linkedin.com" &&
      LINKEDIN_PROFILE_PATH.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export const linkedInProfileUrlSchema = z
  .string()
  .trim()
  .transform(normalizeLinkedInProfileUrl)
  .refine(isLinkedInProfileUrl, {
    message: "Must be a valid LinkedIn profile URL (linkedin.com/in/...)",
  });

export const optionalLinkedInProfileUrlSchema = z
  .string()
  .trim()
  .transform((value) => (value ? normalizeLinkedInProfileUrl(value) : value))
  .refine((value) => value === "" || isLinkedInProfileUrl(value), {
    message: "Must be a valid LinkedIn profile URL (linkedin.com/in/...)",
  })
  .optional();
