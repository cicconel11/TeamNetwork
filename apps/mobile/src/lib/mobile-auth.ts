import { supabase } from "@/lib/supabase";
import { getWebAppUrl } from "@/lib/web-api";

type MobileHandoffResponse = {
  access_token?: string;
  refresh_token?: string;
  error?: string;
};

export async function consumeMobileAuthHandoff(code: string) {
  let response: Response;
  try {
    response = await fetch(`${getWebAppUrl()}/api/auth/mobile-handoff/consume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }

  const payload = (await response.json().catch(() => ({}))) as MobileHandoffResponse;
  if (!response.ok) {
    if (response.status === 400) {
      throw new Error("This sign-in link has expired. Please try signing in again.");
    }
    throw new Error(payload.error || "Could not complete sign in.");
  }

  if (!payload.access_token || !payload.refresh_token) {
    throw new Error("Mobile auth handoff did not return a session.");
  }

  const { error } = await supabase.auth.setSession({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
  });

  if (error) {
    throw error;
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
