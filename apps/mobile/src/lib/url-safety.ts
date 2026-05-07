import * as Linking from "expo-linking";
import { baseSchemas } from "@teammeet/validation";

const HTTPS_PROTOCOL = "https:";
const LINKEDIN_HOST_SUFFIX = ".linkedin.com";
const LINKEDIN_HOSTS = new Set(["linkedin.com", "www.linkedin.com"]);

function parseUrl(value: string): URL | null {
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

export function isValidHttpsUrl(value: string): boolean {
  const url = parseUrl(value);
  return url?.protocol === HTTPS_PROTOCOL;
}

export function isValidEmailAddress(value: string): boolean {
  return baseSchemas.email.safeParse(value.trim().toLowerCase()).success;
}

export function isValidLinkedInUrl(value: string): boolean {
  const url = parseUrl(value);
  if (!url || url.protocol !== HTTPS_PROTOCOL) {
    return false;
  }

  const host = url.hostname.toLowerCase();
  return LINKEDIN_HOSTS.has(host) || host.endsWith(LINKEDIN_HOST_SUFFIX);
}

export async function openHttpsUrl(value: string): Promise<boolean> {
  const url = value.trim();
  if (!isValidHttpsUrl(url)) {
    return false;
  }

  await Linking.openURL(url);
  return true;
}

export async function openEmailAddress(value: string): Promise<boolean> {
  const email = value.trim().toLowerCase();
  if (!isValidEmailAddress(email)) {
    return false;
  }

  await Linking.openURL(`mailto:${email}`);
  return true;
}

export function getNativeAppLinkRoute(value: string): string | null {
  const url = parseUrl(value);
  if (!url || url.protocol !== "teammeet:") {
    return null;
  }

  const route = (url.pathname || url.hostname || "")
    .replace(/^\/+/, "")
    .toLowerCase();

  return route || null;
}

export function sanitizeUrlForTelemetry(value: string): Record<string, unknown> {
  const url = parseUrl(value);
  if (!url) {
    return {
      urlIsValid: false,
    };
  }

  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);

  return {
    urlIsValid: true,
    urlScheme: url.protocol.replace(/:$/, ""),
    urlHost: url.host || null,
    urlPath: url.pathname || "/",
    hasCode: url.searchParams.has("code"),
    hasAccessToken: url.searchParams.has("access_token") || hashParams.has("access_token"),
    hasRefreshToken: url.searchParams.has("refresh_token") || hashParams.has("refresh_token"),
    hasErrorParam: url.searchParams.has("error") || hashParams.has("error"),
    authType: url.searchParams.get("type") || hashParams.get("type"),
  };
}
