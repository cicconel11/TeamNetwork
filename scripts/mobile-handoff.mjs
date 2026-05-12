#!/usr/bin/env node
// Mints a mobile-handoff code for the E2E admin user.
//
// Flow:
//   1. admin/generate_link  -> get an email OTP for the user.
//   2. POST /auth/v1/verify with the OTP -> exchange for access/refresh tokens
//      (no captcha, no redirect dance).
//   3. encryptMobileHandoffToken on each token.
//   4. INSERT into public.mobile_auth_handoffs via service-role REST.
//   5. Print the unhashed `code`.
//
// The mobile app's deep-link handler consumes the code via
// teammeet://callback?handoff_code=<code> and lands a session.

import crypto from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.E2E_ADMIN_EMAIL;
const handoffKey = process.env.AUTH_HANDOFF_ENCRYPTION_KEY;

for (const [name, value] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: url,
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  E2E_ADMIN_EMAIL: email,
  AUTH_HANDOFF_ENCRYPTION_KEY: handoffKey,
})) {
  if (!value) {
    console.error("Missing env:", name);
    process.exit(1);
  }
}

// 1) admin/generate_link -> OTP
let r = await fetch(`${url}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ type: "magiclink", email }),
});
let d = await r.json();
if (!r.ok || !d.email_otp) {
  console.error("generate_link failed:", JSON.stringify(d));
  process.exit(1);
}
const otp = d.email_otp;

// 2) Verify OTP -> tokens
r = await fetch(`${url}/auth/v1/verify`, {
  method: "POST",
  headers: { apikey: anonKey, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email, token: otp }),
});
d = await r.json();
if (!r.ok || !d.access_token || !d.refresh_token) {
  console.error("verify failed:", JSON.stringify(d));
  process.exit(1);
}
const accessToken = d.access_token;
const refreshToken = d.refresh_token;

// 3) Encrypt tokens. Format matches apps/web/src/lib/crypto/token-encryption.ts:
//   key: 64 hex chars (32 bytes), AES-256-GCM, 12-byte IV
//   output: "<iv-base64>:<authTag-base64>:<ciphertext-base64>"
function encryptToken(plain, hexKey) {
  if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
    throw new Error("AUTH_HANDOFF_ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
  }
  const key = Buffer.from(hexKey, "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let ct = cipher.update(plain, "utf8", "base64");
  ct += cipher.final("base64");
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${ct}`;
}

const encryptedAccess = encryptToken(accessToken, handoffKey);
const encryptedRefresh = encryptToken(refreshToken, handoffKey);

// 4) Insert handoff row
const handoffCode = crypto.randomBytes(32).toString("base64url");
const codeHash = crypto.createHash("sha256").update(handoffCode, "utf8").digest("hex");
const userId = d.user?.id;
if (!userId) {
  console.error("No user.id in verify response");
  process.exit(1);
}

r = await fetch(`${url}/rest/v1/mobile_auth_handoffs`, {
  method: "POST",
  headers: {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  },
  body: JSON.stringify({
    code_hash: codeHash,
    user_id: userId,
    encrypted_access_token: encryptedAccess,
    encrypted_refresh_token: encryptedRefresh,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }),
});
if (!r.ok) {
  const text = await r.text();
  console.error("insert handoff failed:", r.status, text);
  process.exit(1);
}

// 5) Print just the deep-link URL so the launcher script can `openurl` it.
console.log(`teammeet://callback?handoff_code=${handoffCode}`);
