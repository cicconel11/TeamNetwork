// ---------------------------------------------------------------------------
// Apify LinkedIn enrichment (replaces the former Bright Data integration).
//
// Apify runs are ASYNCHRONOUS: we start an actor run (returns a runId), attach a
// run-finished webhook, and read the run's dataset items when it completes. A
// single run accepts an array of profile URLs and emits one dataset item per
// profile, so org-wide bulk is one run with N URLs.
//
// Actor: configurable via APIFY_LINKEDIN_ACTOR_ID (default below). The ONLY
// actor-specific code is `normalizeApifyItem` — adjust it to the chosen actor's
// output schema; everything downstream consumes the normalized shape.
// ---------------------------------------------------------------------------

import { getAppUrl } from "@/lib/url";
import { isLinkedInProfileUrl, normalizeLinkedInProfileUrl } from "@/lib/alumni/linkedin-url";
import { sanitizeRichTextToPlainText } from "@/lib/security/rich-text";

// ---------------------------------------------------------------------------
// Normalized profile + mapped fields
// ---------------------------------------------------------------------------

export interface ApifyExperience {
  title: string | null;
  company: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null; // null/"Present" for current roles
  description: string | null;
}

export interface ApifyEducation {
  school: string | null;
  degree: string | null;
  field_of_study: string | null;
  start_year: string | null;
  end_year: string | null;
}

export interface ApifyCertification {
  name: string | null;
  authority: string | null;
}

/** Normalized profile consumed by the rest of the app (provider-neutral). */
export interface ApifyProfileResult {
  profile_url: string | null;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  city: string | null;
  headline: string | null;
  summary: string | null;
  industry: string | null;
  current_company: string | null;
  photo_url: string | null;
  experience: ApifyExperience[];
  education: ApifyEducation[];
  skills: string[];
  certifications: ApifyCertification[];
  languages: string[];
}

/** Mapped fields ready to be written to member/alumni/parent records + RPCs. */
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
  photo_url: string | null;
  work_history: ApifyExperience[] | null;
  education_history: ApifyEducation[] | null;
  skills: string[] | null;
  certifications: ApifyCertification[] | null;
  languages: string[] | null;
}

export type ApifyFailureKind =
  | "not_configured"
  | "invalid_url"
  | "unauthorized"
  | "provider_unavailable"
  | "upstream_error"
  | "malformed_payload"
  | "network_error";

export type ApifyStartResult =
  | { ok: true; runId: string }
  | { ok: false; kind: ApifyFailureKind; error: string; upstreamStatus?: number };

export type ApifyDatasetResult =
  | { ok: true; profiles: ApifyProfileResult[] }
  | { ok: false; kind: ApifyFailureKind; error: string; upstreamStatus?: number };

interface ApifyFetchOptions {
  fetchFn?: typeof fetch;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_ACTOR_ID = "dev_fusion~linkedin-profile-scraper";
const APIFY_BASE_URL = "https://api.apify.com/v2";
const APIFY_WEBHOOK_PATH = "/api/linkedin/apify-webhook";

function getApifyToken(): string | null {
  const token = process.env.APIFY_API_TOKEN;
  if (!token || token.trim() === "") return null;
  return token.trim();
}

function getApifyActorId(): string {
  const id = process.env.APIFY_LINKEDIN_ACTOR_ID;
  return id && id.trim() !== "" ? id.trim() : DEFAULT_ACTOR_ID;
}

function getApifyWebhookSecret(): string | null {
  const secret = process.env.APIFY_WEBHOOK_SECRET;
  if (!secret || secret.trim() === "") return null;
  return secret.trim();
}

export function isApifyConfigured(): boolean {
  return getApifyToken() !== null;
}

/** Verifies the secret carried on the inbound webhook URL (constant-time). */
export function isValidApifyWebhookSecret(candidate: string | null): boolean {
  const expected = getApifyWebhookSecret();
  if (!expected || !candidate) return false;
  if (candidate.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ candidate.charCodeAt(i);
  }
  return mismatch === 0;
}

// ---------------------------------------------------------------------------
// Start an actor run (async). Returns a runId; results arrive via webhook/poll.
// ---------------------------------------------------------------------------

export async function startApifyProfileRun(
  urls: string[],
  options: ApifyFetchOptions = {},
): Promise<ApifyStartResult> {
  const token = getApifyToken();
  const fetchFn = options.fetchFn ?? fetch;

  if (!token) {
    return { ok: false, kind: "not_configured", error: "Apify is not configured." };
  }

  const validUrls = urls.filter((u) => u && isLinkedInProfileUrl(u));
  if (validUrls.length === 0) {
    return { ok: false, kind: "invalid_url", error: "No valid LinkedIn profile URLs." };
  }

  const runUrl = `${APIFY_BASE_URL}/acts/${getApifyActorId()}/runs?token=${encodeURIComponent(token)}${buildWebhookQuery()}`;

  try {
    const res = await fetchFn(runUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileUrls: validUrls }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[apify] start run error:", res.status, body.substring(0, 200));
      if (res.status === 401 || res.status === 403) {
        return { ok: false, kind: "unauthorized", error: "Apify rejected the credentials.", upstreamStatus: res.status };
      }
      if (res.status === 404) {
        return { ok: false, kind: "provider_unavailable", error: "Apify actor not found.", upstreamStatus: res.status };
      }
      return { ok: false, kind: "upstream_error", error: "Apify rejected the run request.", upstreamStatus: res.status };
    }

    const data = await res.json().catch(() => null);
    const runId = data?.data?.id;
    if (typeof runId !== "string" || runId === "") {
      return { ok: false, kind: "malformed_payload", error: "Apify did not return a run id." };
    }
    return { ok: true, runId };
  } catch (err) {
    console.error("[apify] start run network error:", err);
    return { ok: false, kind: "network_error", error: "Unable to reach Apify." };
  }
}

/** Encodes an ad-hoc run-finished webhook so Apify notifies us on completion. */
function buildWebhookQuery(): string {
  const secret = getApifyWebhookSecret();
  if (!secret) return "";
  const requestUrl = `${getAppUrl()}${APIFY_WEBHOOK_PATH}?secret=${encodeURIComponent(secret)}`;
  const webhooks = [
    {
      eventTypes: ["ACTOR.RUN.SUCCEEDED", "ACTOR.RUN.FAILED", "ACTOR.RUN.ABORTED", "ACTOR.RUN.TIMED_OUT"],
      requestUrl,
    },
  ];
  const encoded = Buffer.from(JSON.stringify(webhooks)).toString("base64");
  return `&webhooks=${encodeURIComponent(encoded)}`;
}

export type ApifyRunStatus =
  | "READY"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "ABORTING"
  | "ABORTED"
  | "TIMING-OUT"
  | "TIMED-OUT"
  | "unknown";

const TERMINAL_RUN_STATUSES: ReadonlySet<ApifyRunStatus> = new Set([
  "SUCCEEDED",
  "FAILED",
  "ABORTED",
  "TIMED-OUT",
]);

export function isTerminalApifyRunStatus(status: ApifyRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

/** Returns the current status of an Apify run (for cron reconciliation). */
export async function getApifyRunStatus(
  runId: string,
  options: ApifyFetchOptions = {},
): Promise<ApifyRunStatus> {
  const token = getApifyToken();
  const fetchFn = options.fetchFn ?? fetch;
  if (!token) return "unknown";

  try {
    const res = await fetchFn(
      `${APIFY_BASE_URL}/actor-runs/${encodeURIComponent(runId)}?token=${encodeURIComponent(token)}`,
      { method: "GET" },
    );
    if (!res.ok) return "unknown";
    const data = await res.json().catch(() => null);
    const status = data?.data?.status;
    return typeof status === "string" ? (status as ApifyRunStatus) : "unknown";
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Read a finished run's dataset items.
// ---------------------------------------------------------------------------

export async function fetchApifyRunDataset(
  runId: string,
  options: ApifyFetchOptions = {},
): Promise<ApifyDatasetResult> {
  const token = getApifyToken();
  const fetchFn = options.fetchFn ?? fetch;

  if (!token) {
    return { ok: false, kind: "not_configured", error: "Apify is not configured." };
  }

  const url = `${APIFY_BASE_URL}/actor-runs/${encodeURIComponent(runId)}/dataset/items?token=${encodeURIComponent(token)}&clean=true&format=json`;

  try {
    const res = await fetchFn(url, { method: "GET" });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[apify] dataset fetch error:", res.status, body.substring(0, 200));
      if (res.status === 401 || res.status === 403) {
        return { ok: false, kind: "unauthorized", error: "Apify rejected the credentials.", upstreamStatus: res.status };
      }
      return { ok: false, kind: "upstream_error", error: "Apify dataset fetch failed.", upstreamStatus: res.status };
    }

    const data = await res.json().catch(() => null);
    if (!Array.isArray(data)) {
      return { ok: false, kind: "malformed_payload", error: "Apify returned an unexpected dataset payload." };
    }

    const profiles = data
      .map((item) => normalizeApifyItem(item))
      .filter((p): p is ApifyProfileResult => p !== null);

    return { ok: true, profiles };
  } catch (err) {
    console.error("[apify] dataset fetch network error:", err);
    return { ok: false, kind: "network_error", error: "Unable to reach Apify." };
  }
}

// ---------------------------------------------------------------------------
// Actor-specific normalization (THE seam to verify against the chosen actor).
// Defaults target the dev_fusion/linkedin-profile-scraper output shape; tolerant
// of missing/renamed fields so a partial profile still normalizes.
// ---------------------------------------------------------------------------

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    const s = str(v);
    if (s) return s;
  }
  return null;
}

export function normalizeApifyItem(data: unknown): ApifyProfileResult | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as Record<string, unknown>;

  const hasIdentity =
    str(raw.fullName) ||
    str(raw.firstName) ||
    str(raw.headline) ||
    str(raw.companyName) ||
    Array.isArray(raw.experiences) ||
    Array.isArray(raw.experience);
  if (!hasIdentity) return null;

  const experienceRaw = (Array.isArray(raw.experiences) ? raw.experiences : raw.experience) as unknown[] | undefined;
  const educationRaw = (Array.isArray(raw.educations) ? raw.educations : raw.education) as unknown[] | undefined;
  const certsRaw = (Array.isArray(raw.licenseAndCertificates)
    ? raw.licenseAndCertificates
    : raw.certifications) as unknown[] | undefined;

  return {
    profile_url: firstString(raw.linkedinUrl, raw.url, raw.profileUrl, raw.inputUrl),
    name: firstString(raw.fullName, raw.name),
    first_name: str(raw.firstName),
    last_name: str(raw.lastName),
    city: firstString(raw.addressWithoutCountry, raw.addressWithCountry, raw.location, raw.city),
    headline: firstString(raw.headline, raw.occupation, raw.position),
    summary: firstString(raw.about, raw.summary),
    industry: str(raw.industry),
    current_company: firstString(raw.companyName, raw.company, raw.currentCompany),
    photo_url: firstString(raw.profilePicHighQuality, raw.profilePic, raw.profilePicture, raw.avatar),
    experience: normalizeExperience(experienceRaw),
    education: normalizeEducation(educationRaw),
    skills: normalizeStringList(raw.skills),
    certifications: normalizeCertifications(certsRaw),
    languages: normalizeStringList(raw.languages),
  };
}

function normalizeExperience(raw: unknown[] | undefined): ApifyExperience[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      title: firstString(e.title, e.position),
      company: firstString(e.companyName, e.company, e.subtitle),
      location: str(e.location),
      start_date: firstString(e.startDate, e.start_date),
      end_date: firstString(e.endDate, e.end_date),
      description: sanitizeRichTextToPlainText(firstString(e.description, e.descriptionHtml)),
    }));
}

function normalizeEducation(raw: unknown[] | undefined): ApifyEducation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      school: firstString(e.title, e.school, e.schoolName, e.subtitle),
      degree: firstString(e.degree, e.degreeName),
      field_of_study: firstString(e.fieldOfStudy, e.field_of_study),
      start_year: firstString(e.startYear, e.start_year),
      end_year: firstString(e.endYear, e.end_year),
    }));
}

function normalizeCertifications(raw: unknown[] | undefined): ApifyCertification[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      name: firstString(e.title, e.name),
      authority: firstString(e.authority, e.issuer, e.subtitle),
    }))
    .filter((c) => c.name !== null);
}

function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const s = item.trim();
      if (s) out.push(s);
    } else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const s = firstString(obj.name, obj.title, obj.skill, obj.language);
      if (s) out.push(s);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Map a normalized profile to DB-ready enrichment fields.
// ---------------------------------------------------------------------------

export function mapApifyToFields(profile: ApifyProfileResult): EnrichmentFields {
  const experiences = profile.experience ?? [];
  const education = profile.education ?? [];

  const currentJob = experiences.find((e) => !e.end_date || e.end_date === "Present") ?? experiences[0] ?? null;
  const latestEdu = education[0] ?? null;

  const derivedTitle = currentJob?.title || profile.headline || null;
  const derivedCompany = profile.current_company || currentJob?.company || null;

  return {
    job_title: derivedTitle,
    current_company: derivedCompany,
    industry: profile.industry,
    current_city: profile.city || currentJob?.location || null,
    school: latestEdu?.school || null,
    major: latestEdu?.degree || latestEdu?.field_of_study || null,
    position_title: derivedTitle,
    headline: profile.headline,
    summary: profile.summary,
    photo_url: profile.photo_url,
    work_history: experiences.length > 0 ? experiences : null,
    education_history: education.length > 0 ? education : null,
    skills: profile.skills.length > 0 ? profile.skills : null,
    certifications: profile.certifications.length > 0 ? profile.certifications : null,
    languages: profile.languages.length > 0 ? profile.languages : null,
  };
}

/** Normalized URL key used to match a dataset item back to an input row. */
export function getApifyProfileUrlKey(profile: ApifyProfileResult): string | null {
  if (!profile.profile_url) return null;
  try {
    return normalizeLinkedInProfileUrl(profile.profile_url);
  } catch {
    return null;
  }
}
