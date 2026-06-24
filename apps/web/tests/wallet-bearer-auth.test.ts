import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Regression coverage for the mobile "Add to Apple Wallet" 401.
//
// The mobile client (apps/mobile/src/lib/add-to-wallet.ts) downloads signed
// .pkpass files with an `Authorization: Bearer <supabase access token>` header
// — it has no cookies. The wallet routes originally authenticated with
// getCurrentUser() / getOrgContext(), which read the Supabase session from
// COOKIES only, so every mobile request was rejected with 401.
//
// The fix routes all three wallet endpoints through createAuthenticatedApiClient,
// which honors the Bearer header (and still falls back to cookies for web). These
// static invariants lock the bug class closed across all three sibling routes.

const ROUTES = {
  event:
    "../src/app/api/wallet/event/[eventId]/route.ts",
  member:
    "../src/app/api/wallet/member/[orgSlug]/route.ts",
  receipt:
    "../src/app/api/wallet/receipt/by-payment-attempt/[paymentAttemptId]/route.ts",
} as const;

const sources = Object.fromEntries(
  await Promise.all(
    Object.entries(ROUTES).map(async ([name, rel]) => [
      name,
      await readFile(new URL(rel, import.meta.url), "utf8"),
    ]),
  ),
) as Record<keyof typeof ROUTES, string>;

for (const [name, source] of Object.entries(sources)) {
  test(`wallet ${name} route authenticates via Bearer-aware client`, () => {
    assert.match(
      source,
      /createAuthenticatedApiClient\(\s*req\s*\)/,
      `${name} route must authenticate through createAuthenticatedApiClient(req) so mobile Bearer tokens are honored`,
    );
  });

  test(`wallet ${name} route does not gate auth on cookie-only getCurrentUser`, () => {
    // getCurrentUser() reads cookies only; gating the 401 on it reintroduces
    // the mobile bug. The helper supplies the user instead.
    assert.doesNotMatch(
      source,
      /const\s+user\s*=\s*await\s+getCurrentUser\(\)/,
      `${name} route must not derive the authenticated user from cookie-only getCurrentUser()`,
    );
  });

  test(`wallet ${name} route returns 401 when the Bearer client yields no user`, () => {
    // The unauthorized branch must still exist — the fix widens accepted auth,
    // it does not remove the auth gate.
    assert.match(
      source,
      /if\s*\(\s*!user\s*\)[\s\S]*?status:\s*401/,
      `${name} route must still 401 when no authenticated user is resolved`,
    );
  });
}

test("member route does not gate auth on cookie-only getOrgContext", () => {
  // The member card route originally used getOrgContext() (cookie-based) as its
  // auth + membership gate. Membership must instead be checked with the
  // Bearer-authenticated client.
  assert.doesNotMatch(
    sources.member,
    /orgContext\.userId/,
    "member route must not derive the authenticated user from cookie-only getOrgContext()",
  );
});
