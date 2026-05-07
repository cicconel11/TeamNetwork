const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LINKEDIN_STATE_COOKIE = "linkedin_oauth_state";
export const LINKEDIN_STATE_MAX_AGE_SECONDS = 15 * 60;

export interface LinkedInOAuthStatePayload {
  userId: string;
  timestamp: number;
  redirectPath: string;
  nonce: string;
}

interface CreateLinkedInOAuthStateOptions {
  userId: string;
  redirectPath: string;
  now?: number;
}

interface ValidateLinkedInOAuthStateOptions {
  stateFromQuery: string | null;
  stateFromCookie: string | null;
  defaultRedirectPath: string;
  currentUserId?: string | null;
  now?: number;
}

type LinkedInStateValidationError = "missing_state" | "state_mismatch" | "state_expired";

export type LinkedInOAuthStateValidationResult =
  | {
      ok: true;
      payload: LinkedInOAuthStatePayload;
      redirectPath: string;
    }
  | {
      ok: false;
      error: LinkedInStateValidationError;
      redirectPath: string;
    };

export function normalizeLinkedInRedirectPath(
  redirectPath: string | null | undefined,
  defaultRedirectPath: string,
): string {
  if (!redirectPath) return defaultRedirectPath;
  if (!redirectPath.startsWith("/") || redirectPath.startsWith("//")) {
    return defaultRedirectPath;
  }
  return redirectPath;
}

function encodeStatePayload(payload: LinkedInOAuthStatePayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeStatePayload(state: string): LinkedInOAuthStatePayload | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(state, "base64url").toString("utf8"),
    ) as Partial<LinkedInOAuthStatePayload>;

    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.userId !== "string" || !UUID_RE.test(parsed.userId)) return null;
    if (typeof parsed.timestamp !== "number" || !Number.isFinite(parsed.timestamp)) return null;
    if (typeof parsed.nonce !== "string" || parsed.nonce.trim() === "") return null;
    if (typeof parsed.redirectPath !== "string") return null;

    return {
      userId: parsed.userId,
      timestamp: parsed.timestamp,
      nonce: parsed.nonce,
      redirectPath: parsed.redirectPath,
    };
  } catch {
    return null;
  }
}

export function getLinkedInStateCookieOptions(maxAge = LINKEDIN_STATE_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export function createLinkedInOAuthState({
  userId,
  redirectPath,
  now = Date.now(),
}: CreateLinkedInOAuthStateOptions) {
  const payload: LinkedInOAuthStatePayload = {
    userId,
    timestamp: now,
    redirectPath,
    nonce: crypto.randomUUID(),
  };

  return {
    state: payload.nonce,
    payload,
    cookie: {
      name: LINKEDIN_STATE_COOKIE,
      value: encodeStatePayload(payload),
      options: getLinkedInStateCookieOptions(),
    },
  };
}

export function parseLinkedInOAuthState(state: string): LinkedInOAuthStatePayload | null {
  return decodeStatePayload(state);
}

export function isLinkedInOAuthStateExpired(
  payload: LinkedInOAuthStatePayload,
  { now = Date.now() }: { now?: number } = {},
): boolean {
  return now - payload.timestamp > LINKEDIN_STATE_MAX_AGE_SECONDS * 1000;
}

export function getLinkedInOAuthStateClearCookie() {
  return {
    name: LINKEDIN_STATE_COOKIE,
    value: "",
    options: getLinkedInStateCookieOptions(0),
  };
}

export function validateLinkedInOAuthState({
  stateFromQuery,
  stateFromCookie,
  defaultRedirectPath,
  currentUserId,
  now = Date.now(),
}: ValidateLinkedInOAuthStateOptions): LinkedInOAuthStateValidationResult {
  const cookiePayload = stateFromCookie ? parseLinkedInOAuthState(stateFromCookie) : null;
  const redirectPath = normalizeLinkedInRedirectPath(
    cookiePayload?.redirectPath,
    defaultRedirectPath,
  );

  if (!stateFromQuery || !stateFromCookie || !cookiePayload) {
    return { ok: false, error: "missing_state", redirectPath };
  }

  if (stateFromQuery !== cookiePayload.nonce) {
    return { ok: false, error: "state_mismatch", redirectPath };
  }

  if (isLinkedInOAuthStateExpired(cookiePayload, { now })) {
    return { ok: false, error: "state_expired", redirectPath };
  }

  if (currentUserId && cookiePayload.userId !== currentUserId) {
    return { ok: false, error: "state_mismatch", redirectPath };
  }

  return {
    ok: true,
    payload: cookiePayload,
    redirectPath,
  };
}
