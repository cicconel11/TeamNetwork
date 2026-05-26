// Mobile-local mirror of the web claim-flow guards in
// apps/web/src/lib/auth/claim-flow.ts. Web is the source of truth; this file
// reproduces the same per-process rate-limit + email-confirmed checks before
// the mobile claim screen calls the claim_alumni_profiles RPC.

const CLAIM_WINDOW_MS = 60_000;
const CLAIM_LIMIT_PER_USER = 10;

interface RateBucket {
  count: number;
  resetAt: number;
}

const claimRateStore = new Map<string, RateBucket>();

export function consumeClaimRate(
  userId: string,
  now: number = Date.now(),
): boolean {
  const cur = claimRateStore.get(userId);
  if (!cur || cur.resetAt <= now) {
    claimRateStore.set(userId, { count: 1, resetAt: now + CLAIM_WINDOW_MS });
    return true;
  }
  if (cur.count >= CLAIM_LIMIT_PER_USER) return false;
  cur.count += 1;
  return true;
}

export function assertEmailConfirmed(user: {
  email_confirmed_at?: string | null;
}): void {
  if (!user.email_confirmed_at) {
    throw new Error("Email not verified");
  }
}

export function __resetClaimRateForTests(): void {
  claimRateStore.clear();
}
