import type { Session } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";
import { encryptToken, decryptToken } from "@/lib/crypto/token-encryption";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";

export type MobileAuthMode = "login" | "signup";

export const MOBILE_AUTH_CALLBACK = "teammeet://callback";
const HANDOFF_TTL_MS = 5 * 60 * 1000;

export function isMobileAuthMode(value: string | null): value is MobileAuthMode {
  return value === "login" || value === "signup";
}

function normalizeOrigin(siteUrl: string): string {
  return siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;
}

export function buildMobileAuthCallbackUrl(
  siteUrl: string,
  params: {
    mode: MobileAuthMode;
    redirect?: string | null;
    ageBracket?: string | null;
    isMinor?: string | null;
    ageToken?: string | null;
  }
): string {
  const url = new URL("/auth/callback", normalizeOrigin(siteUrl));
  url.searchParams.set("mobile", "1");
  url.searchParams.set("mode", params.mode);
  url.searchParams.set("redirect", sanitizeRedirectPath(params.redirect ?? null));

  if (params.ageBracket) {
    url.searchParams.set("age_bracket", params.ageBracket);
  }
  if (params.isMinor) {
    url.searchParams.set("is_minor", params.isMinor);
  }
  if (params.ageToken) {
    url.searchParams.set("age_token", params.ageToken);
  }

  return url.toString();
}

export function buildMobileCallbackDeepLink(
  params: Record<string, string | null | undefined>
): string {
  const url = new URL(MOBILE_AUTH_CALLBACK);
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export function buildMobileErrorDeepLink(error: string, description?: string | null): string {
  return buildMobileCallbackDeepLink({
    error,
    error_description: description || error,
  });
}

export function mobileErrorFromCallbackRedirect(location: string): string {
  const parsed = new URL(location);
  const description =
    parsed.searchParams.get("error") ||
    parsed.searchParams.get("message") ||
    "Authentication could not be completed.";

  const error =
    parsed.pathname === "/auth/parental-consent"
      ? "parental_consent_required"
      : parsed.pathname === "/auth/signup"
        ? "age_validation_failed"
        : "auth_callback_failed";

  return buildMobileErrorDeepLink(error, description);
}

export function getAuthHandoffEncryptionKey(): string {
  const key = process.env.AUTH_HANDOFF_ENCRYPTION_KEY;
  if (!key || key.trim() === "") {
    throw new Error("Missing required environment variable: AUTH_HANDOFF_ENCRYPTION_KEY");
  }
  return key;
}

export function hashMobileHandoffCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

export function createMobileHandoffCode(): string {
  return randomBytes(32).toString("base64url");
}

export function encryptMobileHandoffToken(token: string): string {
  return encryptToken(token, getAuthHandoffEncryptionKey());
}

export function decryptMobileHandoffToken(encryptedToken: string): string {
  return decryptToken(encryptedToken, getAuthHandoffEncryptionKey());
}

export function buildMobileHandoffInsert(session: Session, code = createMobileHandoffCode()) {
  return {
    code,
    row: {
      code_hash: hashMobileHandoffCode(code),
      user_id: session.user.id,
      encrypted_access_token: encryptMobileHandoffToken(session.access_token),
      encrypted_refresh_token: encryptMobileHandoffToken(session.refresh_token),
      expires_at: new Date(Date.now() + HANDOFF_TTL_MS).toISOString(),
    },
  };
}
