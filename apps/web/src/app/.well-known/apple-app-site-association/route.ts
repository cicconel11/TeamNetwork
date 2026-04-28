import { NextResponse } from "next/server";

/**
 * Apple App Site Association (AASA) for iOS Universal Links.
 *
 * Served from `/.well-known/apple-app-site-association` with no extension and
 * `Content-Type: application/json` (Apple is strict about both).
 *
 * Set `APPLE_APP_ID_PREFIX` to your Team ID (10-char alphanumeric from
 * https://developer.apple.com/account → Membership → Team ID). For non-prod
 * deploys, the placeholder below is harmless — Universal Links simply won't
 * activate until the real Team ID lands.
 *
 * iOS validates AASA aggressively:
 *   - Must be reachable over HTTPS (no redirects on first fetch)
 *   - Must have correct Content-Type
 *   - Cached for ~24h via Apple's CDN; bump app version or wait for cache flush
 *
 * Verify with: https://search.developer.apple.com/appsearch-validation-tool/
 */
export const dynamic = "force-static";
export const revalidate = 3600;

const TEAM_ID_PLACEHOLDER = "TEAMID0000";
const BUNDLE_ID = "com.myteamnetwork.teammeet";

export function GET() {
  const teamId = process.env.APPLE_APP_ID_PREFIX || TEAM_ID_PLACEHOLDER;
  const appID = `${teamId}.${BUNDLE_ID}`;

  const aasa = {
    applinks: {
      apps: [],
      details: [
        {
          appID,
          paths: [
            // Allowlist-only. Each entry must map to a screen the app can
            // actually render — a Universal Link that opens the app and
            // dead-ends is worse UX than the web fallback.
            //
            // Web-only routes (admin/settings/billing, web sign-in pages,
            // API, Next internals) are deliberately excluded by omission.
            // The NOT patterns below are belt-and-suspenders in case anyone
            // ever adds a catch-all wildcard above; harmless today.
            "/app/join",
            "/app/join/*",
            "/app/parents-join",
            "/app/parents-join/*",
            "/auth/callback",
            "/auth/callback/*",
            "/*/announcements/*",
            "/*/events/*",
            "/*/chat/*",
            "/*/discussions/*",
            "/*/feed/*",
            "/*/jobs/*",
            "/*/mentorship/*",
            "NOT /api/*",
            "NOT /auth/login*",
            "NOT /auth/signup*",
            "NOT /_next/*",
            "NOT /*/settings*",
            "NOT /*/billing*",
            "NOT /*/members*",
            "NOT /*/parents*",
            "NOT /enterprise*",
          ],
        },
      ],
    },
    webcredentials: {
      apps: [appID],
    },
  };

  return NextResponse.json(aasa, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
