/**
 * Unified deep-link parser and router.
 *
 * Single source of truth for converting an incoming URL (from
 * `Linking.getInitialURL`, `Linking.addEventListener('url')`, push notification
 * taps, quick actions, share targets, QR scans, or wallet adds) into a typed
 * `Intent`, and for routing that intent into the app.
 *
 * P0a scope: replaces inline parsing in `app/_layout.tsx`. Shape is forward-
 * compatible with later phases (R2b QR scanner, R6 wallet add, R7 LA tap, R8
 * quick actions) — those add new producers, not new variants.
 *
 * Coordinates with `docs/plans/2026-04-26-001-feat-mobile-oauth-parity-with-web-plan.md`:
 * the OAuth callback handling moves here so both plans converge on one parser.
 */

import type { Router } from "expo-router";
import * as Linking from "expo-linking";
import { supabase } from "@/lib/supabase";
import { parseMobileAuthCallbackUrl } from "@/lib/auth-redirects";
import { consumeMobileAuthHandoff } from "@/lib/mobile-auth";
import { getNativeAppLinkRoute, sanitizeUrlForTelemetry } from "@/lib/url-safety";
import { getWebAppUrl } from "@/lib/web-api";
import { captureException } from "@/lib/analytics";

export type ShortcutAction =
  | "new-announcement"
  | "check-in"
  | "today-events"
  | "scan"
  | "open-chat";

export type Intent =
  // Auth — native scheme (teammeet://callback). Only handoff codes and errors;
  // raw tokens on the native scheme are rejected as a session-fixation defense.
  | { kind: "auth-handoff"; code: string }
  | { kind: "auth-error"; message: string }
  // Auth — trusted web host. PKCE code OR legacy implicit-flow tokens.
  | { kind: "auth-pkce"; code: string }
  | { kind: "auth-implicit"; accessToken: string; refreshToken: string }
  | { kind: "auth-oauth-error"; message: string }
  // App routes
  | { kind: "join-org"; token: string }
  | { kind: "event"; orgSlug: string; eventId: string }
  | {
      kind: "event-checkin";
      orgSlug: string;
      eventId: string;
      userId?: string;
      sig?: string;
    }
  | { kind: "announcement"; orgSlug: string; id: string }
  | { kind: "shortcut"; action: ShortcutAction; orgSlug?: string }
  | { kind: "wallet-add"; passUrl: string }
  // Recognised but not actionable here (e.g. native callback that already
  // matched but had no payload), or unparseable.
  | { kind: "ignored" }
  | { kind: "unknown" };

const TRUSTED_WEB_HOSTS = ["www.myteamnetwork.com", "myteamnetwork.com"];

function getTrustedHosts(): string[] {
  const supabaseHost = process.env.EXPO_PUBLIC_SUPABASE_URL
    ? safeHost(process.env.EXPO_PUBLIC_SUPABASE_URL)
    : null;
  return [supabaseHost, ...TRUSTED_WEB_HOSTS].filter(Boolean) as string[];
}

function safeHost(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

const SHORTCUT_ACTIONS: ReadonlySet<ShortcutAction> = new Set([
  "new-announcement",
  "check-in",
  "today-events",
  "scan",
  "open-chat",
]);

/**
 * Parse a URL into a typed Intent. Pure function — no side effects.
 */
export function parseTeammeetUrl(url: string): Intent {
  // 1. Native scheme — auth callback.
  const mobileAuth = parseMobileAuthCallbackUrl(url);
  if (mobileAuth.type === "handoff") {
    return { kind: "auth-handoff", code: mobileAuth.code };
  }
  if (mobileAuth.type === "error") {
    return { kind: "auth-error", message: mobileAuth.message };
  }

  // 2. Native scheme but not auth — reject raw tokens on `callback`, route
  // other paths (event, join, shortcut, wallet-add).
  const parsed = parseUrl(url);
  if (parsed && parsed.protocol === "teammeet:") {
    const { route, segments } = extractNativeRouteAndSegments(parsed);
    if (route === "callback") {
      return { kind: "ignored" };
    }
    if (route) {
      const intent = parseNativeRoute(route, segments, parsed);
      if (intent) return intent;
    }
  }
  // Fallback: legacy callers that rely on getNativeAppLinkRoute path semantics.
  const nativeRoute = getNativeAppLinkRoute(url);
  if (nativeRoute === "callback") {
    return { kind: "ignored" };
  }

  // 3. Trusted web host with auth payload (PKCE / implicit).
  // HTTPS is mandatory — an http:// payload from a trusted host is almost
  // always a captive-portal redirect or MITM and must not feed into
  // exchangeCodeForSession (session-fixation defense).
  if (!parsed) return { kind: "unknown" };

  if (
    parsed.protocol === "https:" &&
    getTrustedHosts().includes(parsed.hostname)
  ) {
    const looksLikeAuth =
      parsed.searchParams.has("code") ||
      parsed.searchParams.has("access_token") ||
      parsed.hash.includes("access_token") ||
      parsed.pathname.includes("callback");
    if (looksLikeAuth) {
      return parseTrustedAuthPayload(parsed);
    }
  }

  return { kind: "unknown" };
}

/**
 * Resolve the route name and trailing segments for a `teammeet://` URL,
 * tolerating both `teammeet://event/123` (Node parses event as hostname) and
 * `teammeet:event/123` (no hostname; event is the first pathname segment).
 */
function extractNativeRouteAndSegments(
  url: URL
): { route: string | null; segments: string[] } {
  const pathSegments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((s) => decodeURIComponent(s));

  if (url.hostname) {
    return { route: url.hostname.toLowerCase(), segments: pathSegments };
  }
  if (pathSegments.length > 0) {
    return {
      route: pathSegments[0].toLowerCase(),
      segments: pathSegments.slice(1),
    };
  }
  return { route: null, segments: [] };
}

function parseNativeRoute(
  route: string,
  segments: string[],
  url: URL
): Intent | null {
  const orgSlugParam = url.searchParams.get("org") || undefined;

  switch (route) {
    case "join":
    case "join-org": {
      const token =
        url.searchParams.get("token") ||
        url.searchParams.get("code") ||
        segments[0];
      if (!token) return null;
      return { kind: "join-org", token };
    }
    case "event": {
      const eventId = segments[0] || url.searchParams.get("id") || "";
      if (!eventId || !orgSlugParam) return null;
      return { kind: "event", orgSlug: orgSlugParam, eventId };
    }
    case "event-checkin": {
      const eventId = segments[0] || url.searchParams.get("event") || "";
      const userRaw = url.searchParams.get("user") || segments[1] || "";
      const userId = userRaw.trim() ? userRaw : undefined;
      const sig = url.searchParams.get("sig") || undefined;
      if (!eventId || !orgSlugParam) return null;
      return { kind: "event-checkin", orgSlug: orgSlugParam, eventId, userId, sig };
    }
    case "announcement": {
      const id = segments[0] || url.searchParams.get("id") || "";
      if (!id || !orgSlugParam) return null;
      return { kind: "announcement", orgSlug: orgSlugParam, id };
    }
    case "shortcut": {
      const action = url.searchParams.get("action");
      if (!action || !SHORTCUT_ACTIONS.has(action as ShortcutAction)) return null;
      return { kind: "shortcut", action: action as ShortcutAction, orgSlug: orgSlugParam };
    }
    case "wallet-add": {
      const passUrl = url.searchParams.get("url") || segments[0];
      if (!passUrl) return null;
      return { kind: "wallet-add", passUrl };
    }
    default:
      return null;
  }
}

function parseTrustedAuthPayload(url: URL): Intent {
  const errorParam = url.searchParams.get("error");
  if (errorParam) {
    const description = url.searchParams.get("error_description");
    return { kind: "auth-oauth-error", message: description || errorParam };
  }

  const code = url.searchParams.get("code");
  if (code) {
    return { kind: "auth-pkce", code };
  }

  // Legacy implicit flow — tokens may be in hash or query.
  let accessToken: string | null = null;
  let refreshToken: string | null = null;

  if (url.hash) {
    const hashParams = new URLSearchParams(url.hash.substring(1));
    accessToken = hashParams.get("access_token");
    refreshToken = hashParams.get("refresh_token");
  }
  if (!accessToken) {
    accessToken = url.searchParams.get("access_token");
    refreshToken = url.searchParams.get("refresh_token");
  }

  if (accessToken && refreshToken) {
    return { kind: "auth-implicit", accessToken, refreshToken };
  }

  return { kind: "ignored" };
}

/**
 * Execute the side effects for an intent. Handles auth flows inline; for
 * navigation intents, calls router.push with the resolved Expo Router path.
 * `originalUrl` is used only for telemetry on errors.
 */
export async function routeIntent(
  router: Pick<Router, "push" | "replace">,
  intent: Intent,
  originalUrl: string = ""
): Promise<void> {
  switch (intent.kind) {
    case "auth-handoff":
      try {
        await consumeMobileAuthHandoff(intent.code);
      } catch (err) {
        captureException(err as Error, {
          context: "routeIntent.auth-handoff",
          ...sanitizeUrlForTelemetry(originalUrl),
        });
      }
      return;

    case "auth-error":
      captureException(new Error(intent.message), {
        context: "routeIntent.auth-error",
        ...sanitizeUrlForTelemetry(originalUrl),
      });
      return;

    case "auth-oauth-error":
      captureException(new Error(intent.message), {
        context: "routeIntent.auth-oauth-error",
        ...sanitizeUrlForTelemetry(originalUrl),
      });
      return;

    case "auth-pkce":
      try {
        const { error } = await supabase.auth.exchangeCodeForSession(intent.code);
        if (error) {
          captureException(new Error(error.message), {
            context: "routeIntent.auth-pkce",
            ...sanitizeUrlForTelemetry(originalUrl),
          });
        }
      } catch (err) {
        captureException(err as Error, {
          context: "routeIntent.auth-pkce",
          ...sanitizeUrlForTelemetry(originalUrl),
        });
      }
      return;

    case "auth-implicit":
      try {
        await supabase.auth.setSession({
          access_token: intent.accessToken,
          refresh_token: intent.refreshToken,
        });
      } catch (err) {
        captureException(err as Error, {
          context: "routeIntent.auth-implicit",
          ...sanitizeUrlForTelemetry(originalUrl),
        });
      }
      return;

    case "join-org":
      // Defer to the web join handler — it owns invite acceptance, captcha,
      // sign-in/sign-up routing, and parent-vs-org logic. Universal Links
      // bring users with the app installed back into native afterwards.
      try {
        await Linking.openURL(
          `${getWebAppUrl()}/app/join?token=${encodeURIComponent(intent.token)}`
        );
      } catch (err) {
        captureException(err as Error, {
          context: "routeIntent.join-org",
          ...sanitizeUrlForTelemetry(originalUrl),
        });
      }
      return;

    case "event":
      router.push(`/(app)/${intent.orgSlug}/events/${intent.eventId}` as never);
      return;

    case "event-checkin":
      if (!intent.userId) {
        router.push(
          `/(app)/${intent.orgSlug}/events/${intent.eventId}/scan?mode=self` as never
        );
      } else {
        router.push(
          `/(app)/${intent.orgSlug}/events/check-in?eventId=${encodeURIComponent(intent.eventId)}&user=${encodeURIComponent(intent.userId)}` as never
        );
      }
      return;

    case "announcement":
      router.push(`/(app)/${intent.orgSlug}/announcements/${intent.id}` as never);
      return;

    case "shortcut": {
      const slug = intent.orgSlug;
      switch (intent.action) {
        case "new-announcement":
          router.push((slug ? `/(app)/${slug}/announcements/new` : `/(app)`) as never);
          return;
        case "check-in":
          router.push((slug ? `/(app)/${slug}/events` : `/(app)`) as never);
          return;
        case "today-events":
          router.push((slug ? `/(app)/${slug}/events` : `/(app)`) as never);
          return;
        case "scan":
          router.push((slug ? `/(app)/${slug}/events` : `/(app)`) as never);
          return;
        case "open-chat":
          router.push((slug ? `/(app)/${slug}/chat` : `/(app)`) as never);
          return;
      }
      return;
    }

    case "wallet-add":
      // P3 work — placeholder route until R6 ships the WebView handoff screen.
      return;

    case "ignored":
    case "unknown":
      return;
  }
}
