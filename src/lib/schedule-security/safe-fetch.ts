import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { normalizeHost } from "./allowlist";
import { ScheduleSecurityError } from "./errors";

const MAX_REDIRECTS = 2;

export type SafeFetchResult = {
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  text: string;
};

export type SafeFetchConfig = {
  timeoutMs: number;
  maxBytes: number;
  headers?: Record<string, string>;
  onBeforeRequest?: (url: string, host: string) => Promise<void>;
};

export async function safeFetch(url: string, config: SafeFetchConfig, redirectCount = 0): Promise<SafeFetchResult> {
  if (redirectCount > MAX_REDIRECTS) {
    throw new ScheduleSecurityError("too_many_redirects", "Too many redirects.");
  }

  const parsed = new URL(url);
  assertAllowedScheme(parsed);
  assertAllowedPort(parsed);

  const host = normalizeHost(parsed.hostname);
  await ensurePublicHost(host);

  if (config.onBeforeRequest) {
    await config.onBeforeRequest(url, host);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": "TeamMeet-ScheduleSync/1.0",
        Accept: "text/html,application/json,text/calendar,text/plain",
        ...config.headers,
      },
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        const headers = collectHeaders(response);
        return { finalUrl: url, status: response.status, headers, text: "" };
      }

      const redirected = new URL(location, url).toString();
      return safeFetch(redirected, config, redirectCount + 1);
    }

    const headers = collectHeaders(response);
    const text = await readResponseText(response, config.maxBytes);

    return { finalUrl: url, status: response.status, headers, text };
  } catch (error) {
    if (error instanceof ScheduleSecurityError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "Fetch failed.";
    throw new ScheduleSecurityError("fetch_failed", message);
  } finally {
    clearTimeout(timeout);
  }
}

function collectHeaders(response: Response) {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

function assertAllowedScheme(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ScheduleSecurityError("invalid_url", "URL must start with http(s) or webcal.");
  }
}

function assertAllowedPort(url: URL) {
  if (!url.port) return;
  if (url.port !== "80" && url.port !== "443") {
    throw new ScheduleSecurityError("invalid_port", "Only ports 80 and 443 are allowed.");
  }
}

async function ensurePublicHost(hostname: string) {
  if (hostname === "localhost" || hostname.endsWith(".local")) {
    throw new ScheduleSecurityError("localhost", "Localhost URLs are not allowed.");
  }

  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new ScheduleSecurityError("private_ip", "Private IPs are not allowed.");
    }
    return;
  }

  const addresses = await lookup(hostname, { all: true });
  for (const addr of addresses) {
    if (isPrivateIp(addr.address)) {
      throw new ScheduleSecurityError("private_ip", "Private IPs are not allowed.");
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
        throw new ScheduleSecurityError("response_too_large", "Response exceeds size limit.");
      }
      text += decoder.decode(value, { stream: true });
    }
  }

  text += decoder.decode();
  return text;
}
