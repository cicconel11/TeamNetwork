import { supabase } from "@/lib/supabase";
import { getWebAppUrl } from "@/lib/web-api";
import { captureMessage } from "@/lib/analytics";

type MobileHandoffResponse = {
  access_token?: string;
  refresh_token?: string;
  error?: string;
};

/**
 * Failure classes for the mobile handoff consume. Each maps to a distinct
 * user-facing message so 401 (unauthorized) and 500 (server) no longer collapse
 * into one indistinguishable error. `server` and `network` are retryable.
 */
export type MobileAuthErrorStatus =
  | "expired"
  | "unauthorized"
  | "server"
  | "network"
  | "malformed"
  | "session-error";

/**
 * Discriminated error thrown by `consumeMobileAuthHandoff`. `message` is safe to
 * show to the user (no tokens/codes); `status` drives message + retry affordance
 * in `surfaceMobileAuthError`.
 */
export class MobileAuthError extends Error {
  readonly status: MobileAuthErrorStatus;

  constructor(status: MobileAuthErrorStatus, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MobileAuthError";
    this.status = status;
  }
}

// Network errors immediately after the OAuth browser dismisses are often
// transient (the app is still returning to the foreground). Retry the request a
// couple of times before surfacing a failure.
const HANDOFF_RETRY_DELAYS_MS = [300, 800];

export async function consumeMobileAuthHandoff(code: string) {
  let response: Response | null = null;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await fetch(`${getWebAppUrl()}/api/auth/mobile-handoff/consume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      break;
    } catch (err) {
      if (attempt >= HANDOFF_RETRY_DELAYS_MS.length) {
        captureMessage("[mobile-handoff] consume fetch failed after retries", "error");
        throw new MobileAuthError(
          "network",
          "Couldn't reach the server. Check your connection and try again.",
          { cause: err }
        );
      }
      await new Promise((resolve) => setTimeout(resolve, HANDOFF_RETRY_DELAYS_MS[attempt]));
    }
  }

  const payload = (await response.json().catch(() => ({}))) as MobileHandoffResponse;
  captureMessage(`[mobile-handoff] consume status=${response.status}`, "info");
  if (!response.ok) {
    if (response.status === 400) {
      throw new MobileAuthError(
        "expired",
        "This sign-in link has expired. Please try signing in again."
      );
    }
    if (response.status === 401) {
      throw new MobileAuthError(
        "unauthorized",
        "We couldn't verify this sign-in. Please try signing in again."
      );
    }
    if (response.status >= 500) {
      throw new MobileAuthError(
        "server",
        "Something went wrong on our end. Please try again in a moment."
      );
    }
    throw new MobileAuthError("server", "Could not complete sign in. Please try again.");
  }

  if (!payload.access_token || !payload.refresh_token) {
    throw new MobileAuthError("malformed", "Mobile auth handoff did not return a session.");
  }

  const { error } = await supabase.auth.setSession({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
  });

  if (error) {
    throw new MobileAuthError(
      "session-error",
      "We signed you in but couldn't start your session. Please try again.",
      { cause: error }
    );
  }
}

export async function validateSignupAge(ageBracket: "under_13" | "13_17" | "18_plus") {
  const response = await fetch(`${getWebAppUrl()}/api/auth/validate-age`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ageBracket }),
  });

  const payload = await response.json().catch(() => ({})) as {
    token?: string;
    ageBracket?: "13_17" | "18_plus";
    isMinor?: boolean;
    redirect?: string;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error || "Unable to verify age. Please try again.");
  }

  if (payload.redirect) {
    throw new Error("Parental consent is required for users under 13.");
  }

  if (!payload.token || !payload.ageBracket || typeof payload.isMinor !== "boolean") {
    throw new Error("Age verification did not return a valid token.");
  }

  return {
    token: payload.token,
    ageBracket: payload.ageBracket,
    isMinor: payload.isMinor,
  };
}
