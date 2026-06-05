import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routeSource = await readFile(
  new URL(
    "../src/app/api/organizations/[organizationId]/mentorship/admin/candidates/route.ts",
    import.meta.url
  ),
  "utf8"
);

// The propose+accept+audit logic now lives in a shared helper so both the route
// and the AI confirm handler call identical code.
const pairingSource = await readFile(
  new URL("../src/lib/mentorship/admin-pairing.ts", import.meta.url),
  "utf8"
);

test("route exports GET and POST, dynamic + nodejs", () => {
  assert.match(routeSource, /export async function GET/);
  assert.match(routeSource, /export async function POST/);
  assert.match(routeSource, /export const dynamic = "force-dynamic"/);
  assert.match(routeSource, /export const runtime = "nodejs"/);
});

test("both handlers are admin-gated and rate-limited", () => {
  const adminGates = routeSource.match(/requireActiveOrgAdmin/g) ?? [];
  assert.ok(adminGates.length >= 2, "GET and POST must both call requireActiveOrgAdmin");
  assert.match(routeSource, /mentorship admin candidates/);
  assert.match(routeSource, /mentorship admin pairing confirm/);
});

test("GET uses the fallback ranker via suggestMentorsForPairing", () => {
  assert.match(routeSource, /suggestMentorsForPairing/);
  // mentee_user_id is validated as a uuid
  assert.match(routeSource, /mentee_user_id/);
  assert.match(routeSource, /baseSchemas\.uuid\.safeParse/);
});

test("GET attaches a why but never blocks the response on AI failure", () => {
  assert.match(routeSource, /generateMatchWhyBatch/);
  // why generation is wrapped in try/catch so a failure leaves whyById empty
  assert.match(routeSource, /catch\s*{[\s\S]*?leave whyById empty/);
});

test("POST delegates to the shared executeAdminPairing helper", () => {
  assert.match(routeSource, /executeAdminPairing\(/);
  // Partial-success path (accept failed) still returns 200 with a warning.
  assert.match(routeSource, /outcome\.warning/);
});

test("executeAdminPairing reuses admin_propose_pair and handles idempotent races", () => {
  assert.match(pairingSource, /admin_propose_pair/);
  assert.match(pairingSource, /23505/); // unique_violation handled, not 500
});

test("executeAdminPairing recomputes score/signals server-side (does not trust client)", () => {
  assert.match(pairingSource, /suggestMentorsForPairing[\s\S]*?ranking\.candidates\.find/);
  assert.match(pairingSource, /p_match_score: candidate\.score/);
  assert.match(pairingSource, /p_match_signals: matchSignals/);
});

test("executeAdminPairing makes the pairing admin-authoritative and audits the source", () => {
  assert.match(pairingSource, /accept_mentorship_proposal/);
  assert.match(pairingSource, /admin_override: true/);
  assert.match(pairingSource, /source: "admin_pairing_surface"/);
});
