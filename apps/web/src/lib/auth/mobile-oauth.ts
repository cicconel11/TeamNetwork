import type { Session } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";
import { encryptToken, decryptToken } from "@/lib/crypto/token-encryption";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { LINKEDIN_OIDC_PROVIDER } from "@/lib/linkedin/config";
import { MICROSOFT_SSO_PROVIDER } from "@/lib/microsoft/sso-config";

export type MobileAuthMode = "login" | "signup";

/** Provider slugs the mobile app sends in the `/auth/mobile/[provider]` path. */
export type MobileOAuthProvider = "google" | "linkedin" | "microsoft";

/** Supabase provider ids these map to (`linkedin`→`linkedin_oidc`, `microsoft`→`azure`). */
export type SupabaseOAuthProvider = "google" | typeof LINKEDIN_OIDC_PROVIDER | typeof MICROSOFT_SSO_PROVIDER;

export const MOBILE_AUTH_CALLBACK = "teammeet://callback";
const HANDOFF_TTL_MS = 5 * 60 * 1000;

export function isMobileAuthMode(value: string | null): value is MobileAuthMode {
  return value === "login" || value === "signup";
}

/**
 * Maps a mobile provider slug to its Supabase provider id, or null if unsupported.
 * The mobile app uses friendly slugs (`linkedin`, `microsoft`) that differ from
 * Supabase's provider ids (`linkedin_oidc`, `azure`).
 */
export function mapMobileOAuthProvider(provider: string): SupabaseOAuthProvider | null {
  switch (provider) {
    case "google":
      return "google";
    case "linkedin":
      return LINKEDIN_OIDC_PROVIDER;
    case "microsoft":
      return MICROSOFT_SSO_PROVIDER;
    default:
      return null;
  }
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

/**
 * Thrown when a handoff blob carries a key id that is not in the current
 * keyring (e.g. the key was rotated out before the rotation window closed, or
 * the blob was tampered with). The message intentionally carries NO ciphertext
 * or key material — only the fact that the id is unknown — so it is safe to log.
 * The consume route classifies this distinctly from a generic decrypt failure so
 * ops can tell a rotation gap apart from tampering.
 */
export class UnknownHandoffKeyIdError extends Error {
  constructor() {
    super("unknown handoff key id");
    this.name = "UnknownHandoffKeyIdError";
  }
}

/**
 * Derives a stable, non-secret key id from a handoff encryption key: the first
 * 8 hex chars of sha256(key). Chosen so the id is:
 *   - deterministic (no new env var, no config to drift out of sync),
 *   - non-reversible (a truncated hash leaks nothing useful about the key),
 *   - stable across restarts and across the web/dev-script boundary.
 * `scripts/mobile-handoff.mjs` reimplements this same scheme; keep them in sync.
 */
export function deriveHandoffKeyId(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex").slice(0, 8);
}

type HandoffKeyEntry = { id: string; key: string };

/**
 * Builds the handoff keyring: the required current key plus an optional previous
 * key (`AUTH_HANDOFF_ENCRYPTION_KEY_PREVIOUS`) kept during a rotation window so
 * blobs minted under the old key still decrypt. Order matters: the current key
 * is first so it is used for legacy (unversioned) blobs.
 */
function getHandoffKeyring(): { current: HandoffKeyEntry; all: HandoffKeyEntry[] } {
  const currentKey = getAuthHandoffEncryptionKey();
  const current: HandoffKeyEntry = { id: deriveHandoffKeyId(currentKey), key: currentKey };
  const all: HandoffKeyEntry[] = [current];

  const previousKey = process.env.AUTH_HANDOFF_ENCRYPTION_KEY_PREVIOUS;
  if (previousKey && previousKey.trim() !== "") {
    const previousId = deriveHandoffKeyId(previousKey);
    // Guard against a misconfigured window where PREVIOUS == CURRENT.
    if (previousId !== current.id) {
      all.push({ id: previousId, key: previousKey });
    }
  }

  return { current, all };
}

export function hashMobileHandoffCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

export function createMobileHandoffCode(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Encrypts a handoff token, tagging the blob with the current key id so a later
 * decrypt can pick the right key from the keyring after a rotation. Wire format:
 * `keyId:iv:authTag:ciphertext` (4 colon-parts). The inner `iv:authTag:ciphertext`
 * is produced by the UNCHANGED shared `encryptToken`; versioning lives only here,
 * at the handoff wrapper layer, so the shared crypto format (used by 9 other
 * long-lived callers) is untouched.
 */
export function encryptMobileHandoffToken(token: string): string {
  const { current } = getHandoffKeyring();
  return `${current.id}:${encryptToken(token, current.key)}`;
}

/**
 * Decrypts a handoff token. Two shapes are accepted:
 *   - 4 parts (`keyId:iv:authTag:ciphertext`): the versioned format. The leading
 *     key id is looked up in the keyring; an unknown id throws
 *     UnknownHandoffKeyIdError (distinct from a decrypt failure).
 *   - 3 parts (`iv:authTag:ciphertext`): a legacy blob minted before versioning.
 *     Decrypted with the current key for back-compat rather than silently failing
 *     to parse. The 5-minute handoff TTL bounds how long such blobs can exist, so
 *     this back-compat path closes on its own shortly after deploy.
 */
export function decryptMobileHandoffToken(encryptedToken: string): string {
  const parts = encryptedToken.split(":");
  const { current, all } = getHandoffKeyring();

  if (parts.length === 4) {
    const [keyId, ...rest] = parts;
    const entry = all.find((k) => k.id === keyId);
    if (!entry) {
      throw new UnknownHandoffKeyIdError();
    }
    return decryptToken(rest.join(":"), entry.key);
  }

  // Legacy, unversioned blob: decrypt with the current key. TTL-bounded.
  return decryptToken(encryptedToken, current.key);
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
