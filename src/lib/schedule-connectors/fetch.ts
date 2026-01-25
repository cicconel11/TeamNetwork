import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export type SafeFetchResult = {
  finalUrl: string;
  text: string;
  headers: Record<string, string>;
};

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  allowlist?: string[];
  requireAllowlist?: boolean;
  headers?: Record<string, string>;
};

export function normalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  const normalized = trimmed.startsWith("webcal://")
    ? `https://${trimmed.slice("webcal://".length)}`
    : trimmed;
  const parsed = new URL(normalized);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL must start with http(s) or webcal.");
  }

  return parsed.toString();
}

export function maskUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    const tail = rawUrl.slice(-6);
    return `${parsed.host}/...${tail}`;
  } catch {
    return "hidden";
  }
}

export function getAllowlistFromEnv(): string[] {
  const raw = process.env.SCHEDULE_SOURCE_ALLOWLIST || process.env.SCHEDULE_SOURCE_ALLOWLIST_HOSTS || "";
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export async function fetchUrlSafe(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const normalizedUrl = normalizeUrl(rawUrl);
  const allowlist = options.allowlist ?? getAllowlistFromEnv();

  const { response, finalUrl } = await fetchWithRedirects(
    normalizedUrl,
    {
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
      allowlist,
      requireAllowlist: options.requireAllowlist ?? false,
      headers: options.headers ?? {},
    },
    0
  );

  if (!response.ok) {
    throw new Error(`Fetch failed (${response.status})`);
  }

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const text = await readResponseText(response, options.maxBytes ?? DEFAULT_MAX_BYTES);

  return { finalUrl, text, headers };
}

async function fetchWithRedirects(
  url: string,
  options: Required<SafeFetchOptions>,
  redirectCount: number
): Promise<{ response: Response; finalUrl: string }> {
  if (redirectCount > MAX_REDIRECTS) {
    throw new Error("Too many redirects.");
  }

  await assertHostAllowed(url, options.allowlist, options.requireAllowlist);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": "TeamMeet-ScheduleSync/1.0",
        Accept: "text/html,application/json,text/calendar,text/plain",
        ...options.headers,
      },
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return { response, finalUrl: url };
      }

      const redirected = new URL(location, url).toString();
      return fetchWithRedirects(redirected, options, redirectCount + 1);
    }

    return { response, finalUrl: url };
  } finally {
    clearTimeout(timeout);
  }
}

async function assertHostAllowed(url: string, allowlist: string[], requireAllowlist: boolean) {
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();

  if (hostname === "localhost" || hostname.endsWith(".local")) {
    throw new Error("Localhost URLs are not allowed.");
  }

  await ensurePublicHost(hostname);

  if (requireAllowlist) {
    if (allowlist.length === 0) {
      throw new Error("No allowlist configured for schedule sources.");
    }

    const matches = allowlist.some((entry) => hostMatchesAllowlist(hostname, entry));
    if (!matches) {
      throw new Error("Source domain is not allowlisted.");
    }
  }
}

function hostMatchesAllowlist(host: string, entry: string) {
  if (entry.startsWith("*.")) {
    return host === entry.slice(2) || host.endsWith(entry.slice(1));
  }

  if (entry.startsWith(".")) {
    return host === entry.slice(1) || host.endsWith(entry);
  }

  return host === entry;
}

async function ensurePublicHost(hostname: string) {
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error("Private IPs are not allowed.");
    }
    return;
  }

  const addresses = await lookup(hostname, { all: true });
  for (const addr of addresses) {
    if (isPrivateIp(addr.address)) {
      throw new Error("Private IPs are not allowed.");
    }
  }
}

function isPrivateIp(ip: string) {
  if (ip === "::1") return true;

  if (ip.startsWith("::ffff:")) {
    return isPrivateIp(ip.replace("::ffff:", ""));
  }

  if (isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  const lower = ip.toLowerCase();
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80")) return true;

  return false;
}

function isIPv4(ip: string) {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const num = Number(part);
    return Number.isInteger(num) && num >= 0 && num <= 255;
  });
}

async function readResponseText(response: Response, maxBytes: number) {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      received += value.length;
      if (received > maxBytes) {
        throw new Error("Response exceeds size limit.");
      }
      text += decoder.decode(value, { stream: true });
    }
  }

  text += decoder.decode();
  return text;
}
