"use server";

import { createClient } from "@/lib/supabase/server";

export interface ClaimedOrg {
  id: string;
  slug: string;
}

export interface ClaimAlumniResult {
  orgs: ClaimedOrg[];
}

declare global {
  // eslint-disable-next-line no-var
  var __claimAlumniRateLimit: Map<string, { count: number; resetAt: number }> | undefined;
}
const claimRateStore = globalThis.__claimAlumniRateLimit ?? new Map();
globalThis.__claimAlumniRateLimit = claimRateStore;
const CLAIM_WINDOW_MS = 60_000;
const CLAIM_LIMIT_PER_USER = 10;

function consumeClaimRate(userId: string): boolean {
  const now = Date.now();
  const cur = claimRateStore.get(userId);
  if (!cur || cur.resetAt <= now) {
    claimRateStore.set(userId, { count: 1, resetAt: now + CLAIM_WINDOW_MS });
    return true;
  }
  if (cur.count >= CLAIM_LIMIT_PER_USER) return false;
  cur.count += 1;
  return true;
}

// Server action: after OTP verify, grant org membership for every imported
// alumni row matching the session user's verified email. Wraps RPC
// claim_alumni_profiles which derives subject + email from auth.uid()
// server-side — no caller-supplied identity. Caller branches on orgs.length
// for redirect.
export async function claimAlumniProfile(): Promise<ClaimAlumniResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error("Not authenticated");
  }

  // Defense-in-depth: only proceed if the email has actually been verified
  // in this session. The OTP step sets email_confirmed_at on success; this
  // check rejects callers from any pre-OTP path that would otherwise grant
  // membership on an unverified email.
  if (!user.email_confirmed_at) {
    throw new Error("Email not verified");
  }

  if (!consumeClaimRate(user.id)) {
    throw new Error("Too many claim attempts. Please retry shortly.");
  }

  const { data, error } = await supabase.rpc("claim_alumni_profiles");

  if (error) {
    console.error("[claimAlumniProfile] rpc error", {
      userId: user.id,
      message: error.message,
    });
    throw new Error("Failed to claim alumni profile");
  }

  const rows = (data ?? []) as Array<{
    out_organization_id: string;
    out_slug: string;
  }>;
  const orgs: ClaimedOrg[] = rows.map((r) => ({
    id: r.out_organization_id,
    slug: r.out_slug,
  }));

  return { orgs };
}
