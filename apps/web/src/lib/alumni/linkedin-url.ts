import { z } from "zod";

const LINKEDIN_PROFILE_PATH = /^\/in\/[a-zA-Z0-9_-]+$/;

export function normalizeLinkedInProfileUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  try {
    const url = new URL(trimmed);

    if (url.protocol === "http:") {
      url.protocol = "https:";
    }

    if (url.hostname === "linkedin.com") {
      url.hostname = "www.linkedin.com";
    }

    url.pathname = url.pathname.replace(/\/+$/, "");

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
