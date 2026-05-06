import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// R4 redefined: imported alumni rows ARE membership grants. After OTP verify,
// the claim flow calls server action claimAlumniProfile, which inserts
// user_organization_roles for every unlinked alumni row matching the verified
// email. The existing handle_org_member_sync trigger then links
// alumni.user_id and provisions the directory row.
//
// Magic-link sign-in alone STILL grants zero membership — the prior admin
// import is the grant; OTP just unlocks it.
//
// The repo has no DB-integration harness for the trigger path, so we enforce
// the wiring at the source-code level.

const claimClientPath = path.join(
  process.cwd(),
  "src",
  "app",
  "auth",
  "claim",
  "ClaimAccountClient.tsx",
);

function readClaimClient(): string {
  return fs.readFileSync(claimClientPath, "utf8");
}

test("claim client requests OTP code via signInWithOtp", () => {
  const src = readClaimClient();
  assert.match(
    src,
    /signInWithOtp\s*\(/,
    "Claim flow must call signInWithOtp to issue the OTP.",
  );
});

test("claim client does not use email-link callback (no emailRedirectTo)", () => {
  const src = readClaimClient();
  assert.doesNotMatch(
    src,
    /emailRedirectTo/,
    "Claim flow must not use emailRedirectTo — the email-link path is vulnerable to mail-client prefetch consuming the single-use token before the user clicks it.",
  );
});

test("claim client verifies the OTP token client-side", () => {
  const src = readClaimClient();
  assert.match(
    src,
    /verifyOtp\s*\(/,
    "Claim flow must verify the user-entered OTP via supabase.auth.verifyOtp.",
  );
  assert.match(
    src,
    /type:\s*["']email["']/,
    "verifyOtp must use the email OTP type.",
  );
});

test("claim client invokes claimAlumniProfile after OTP verify", () => {
  const src = readClaimClient();
  assert.match(
    src,
    /import\s*\{[^}]*claimAlumniProfile[^}]*\}\s*from\s*["']@\/lib\/auth\/claim-flow["']/,
    "Claim client must import claimAlumniProfile from the server action module.",
  );
  assert.match(
    src,
    /claimAlumniProfile\s*\(\s*pendingEmail/,
    "Claim client must call claimAlumniProfile with the verified email after OTP verify.",
  );
});

test("claim client redirects to single org slug on 1 match", () => {
  const src = readClaimClient();
  assert.match(
    src,
    /router\.push\s*\(\s*`\/\$\{orgs\[0\]\.slug\}`\s*\)/,
    "1-match path must redirect to /[orgSlug].",
  );
});

test("claim client redirects to /app on 2+ matches", () => {
  const src = readClaimClient();
  assert.match(
    src,
    /router\.push\s*\(\s*["']\/app["']\s*\)/,
    "2+-match path must redirect to /app for org picking.",
  );
});

test("claim client falls back to /app/join on zero matches", () => {
  const src = readClaimClient();
  assert.match(
    src,
    /\/app\/join/,
    "0-match path must funnel users to /app/join for invite redemption.",
  );
});

test("claim client uses captcha gate before issuing the OTP", () => {
  const src = readClaimClient();
  assert.match(
    src,
    /isVerified\s*\|\|\s*!?captchaToken|!isVerified\s*\|\|\s*!captchaToken/i,
    "Claim submit must require captcha verification.",
  );
  assert.match(
    src,
    /captchaToken/,
    "Captcha token must be passed to signInWithOtp.",
  );
});

test("claim client surfaces a generic success message, not differential responses", () => {
  const src = readClaimClient();
  assert.match(
    src,
    /claimCodeSent/,
    "Claim flow must show a generic success message regardless of email-known status.",
  );
});

// ── Server action shape ────────────────────────────────────────────────

const claimFlowPath = path.join(
  process.cwd(),
  "src",
  "lib",
  "auth",
  "claim-flow.ts",
);

function readClaimFlow(): string {
  return fs.readFileSync(claimFlowPath, "utf8");
}

test("claim-flow module is a server action", () => {
  const src = readClaimFlow();
  assert.match(
    src,
    /^\s*["']use server["']/m,
    "claim-flow.ts must declare \"use server\".",
  );
});

test("claim-flow rejects unauthenticated callers", () => {
  const src = readClaimFlow();
  assert.match(
    src,
    /Not authenticated/,
    "Server action must throw on missing session, not return empty.",
  );
});

test("claim-flow validates verifiedEmail matches session user", () => {
  const src = readClaimFlow();
  assert.match(
    src,
    /Email does not match session user/,
    "Server action must reject email-mismatch before invoking RPC.",
  );
});

test("claim-flow calls the claim_alumni_profiles RPC", () => {
  const src = readClaimFlow();
  assert.match(
    src,
    /supabase\.rpc\(\s*["']claim_alumni_profiles["']/,
    "Server action must invoke claim_alumni_profiles RPC.",
  );
});
