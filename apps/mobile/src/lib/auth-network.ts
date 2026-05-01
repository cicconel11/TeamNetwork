import { NetworkUnreachableError } from "@/lib/web-api";

const FRIENDLY_UNREACHABLE =
  "Couldn't reach the server. Check your connection and try again.";

export function friendlyAuthError(err: unknown): string {
  if (err instanceof NetworkUnreachableError) {
    return FRIENDLY_UNREACHABLE;
  }

  const message = err instanceof Error ? err.message : "";
  if (message && /network request failed/i.test(message)) {
    return FRIENDLY_UNREACHABLE;
  }

  if (message) return message;

  return "Something went wrong. Please try again.";
}

const PING_TIMEOUT_MS = 5000;

async function pingWithTimeout(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function pingAuthSurfaces(
  supabaseUrl?: string,
): Promise<{ supabase: boolean }> {
  const supaUrl =
    supabaseUrl?.trim() || process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || "";

  if (!supaUrl) return { supabase: false };

  const ok = await pingWithTimeout(
    `${supaUrl.replace(/\/+$/, "")}/auth/v1/health`,
  );
  return { supabase: ok };
}
