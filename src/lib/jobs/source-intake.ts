import * as cheerio from "cheerio";
import { safeFetch, type SafeFetchResult } from "@/lib/schedule-security/safe-fetch";

const SOURCE_TIMEOUT_MS = 8_000;
const SOURCE_MAX_BYTES = 512 * 1024;

export interface JobSourceDraft {
  title?: string;
  company?: string;
  location?: string;
  industry?: string;
  description?: string;
}

export class JobSourceIntakeError extends Error {
  code: "invalid_source_url" | "fetch_failed";

  constructor(code: "invalid_source_url" | "fetch_failed", message: string) {
    super(message);
    this.code = code;
  }
}

export async function fetchJobSourceDraft(url: string): Promise<JobSourceDraft> {
  let response: SafeFetchResult;
  try {
    response = await safeFetch(url, {
      timeoutMs: SOURCE_TIMEOUT_MS,
      maxBytes: SOURCE_MAX_BYTES,
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to fetch job posting";
    throw new JobSourceIntakeError("invalid_source_url", message);
  }

  if (response.status >= 400) {
    throw new JobSourceIntakeError("fetch_failed", `Fetch failed (${response.status})`);
  }

  const contentType = response.headers["content-type"] ?? "";
  if (!/html|text\/plain/i.test(contentType)) {
    throw new JobSourceIntakeError("fetch_failed", "Unsupported job posting content type");
  }

  return extractJobSourceDraft(response.text);
}

export function extractJobSourceDraft(html: string): JobSourceDraft {
  const $ = cheerio.load(html);
  const title =
    firstNonEmpty(
      $('meta[property="og:title"]').attr("content"),
      $("title").text(),
      $("h1").first().text()
    ) ?? undefined;
  const description =
    firstNonEmpty(
      $('meta[name="description"]').attr("content"),
      $('[data-testid*="job-description"]').text(),
      $("main").text(),
      $("body").text()
    ) ?? undefined;

  const normalizedTitle = normalizeText(title);
  const normalizedDescription = truncateDescription(normalizeText(description));

  const company =
    extractLabeledField(html, ["company", "organization", "employer"]) ??
    extractFromJsonLd(html, ["hiringOrganization", "name"]);
  const location =
    extractLabeledField(html, ["location", "job location"]) ??
    extractFromJsonLd(html, ["jobLocation", "address", "addressLocality"]);
  const industry =
    extractLabeledField(html, ["industry", "team", "department"]) ??
    extractFromJsonLd(html, ["industry"]);

  return {
    ...(normalizedTitle ? { title: normalizedTitle } : {}),
    ...(normalizeText(company) ? { company: normalizeText(company) } : {}),
    ...(normalizeText(location) ? { location: normalizeText(location) } : {}),
    ...(normalizeText(industry) ? { industry: normalizeText(industry) } : {}),
    ...(normalizedDescription ? { description: normalizedDescription } : {}),
  };
}

function normalizeText(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function truncateDescription(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length > 4000 ? `${value.slice(0, 3997).trim()}...` : value;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) return normalized;
  }
  return undefined;
}

function extractLabeledField(html: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`${escaped}\\s*[:\\-]\\s*([^\\n<]{2,120})`, "i");
    const match = html.match(pattern);
    const normalized = normalizeText(match?.[1]);
    if (normalized) return normalized;
  }
  return undefined;
}

function extractFromJsonLd(html: string, path: string[]): string | undefined {
  const matches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of matches) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const value = resolveJsonLdPath(parsed, path);
      const normalized = normalizeText(typeof value === "string" ? value : undefined);
      if (normalized) return normalized;
    } catch {
      continue;
    }
  }
  return undefined;
}

function resolveJsonLdPath(value: unknown, path: string[]): unknown {
  if (path.length === 0 || value == null) return value;
  const [head, ...tail] = path;

  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = resolveJsonLdPath(item, path);
      if (resolved != null) return resolved;
    }
    return undefined;
  }

  if (typeof value === "object" && head in (value as Record<string, unknown>)) {
    return resolveJsonLdPath((value as Record<string, unknown>)[head], tail);
  }

  return undefined;
}
