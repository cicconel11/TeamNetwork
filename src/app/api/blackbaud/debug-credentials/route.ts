import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cleanEnvValue(raw: string | undefined): string {
  if (!raw) return "";
  return raw.replace(/\\n/g, "").trim();
}

export async function GET() {
  const clientId = cleanEnvValue(process.env.BLACKBAUD_CLIENT_ID);
  const clientSecret = cleanEnvValue(process.env.BLACKBAUD_CLIENT_SECRET);
  const subscriptionKey = cleanEnvValue(process.env.BLACKBAUD_SUBSCRIPTION_KEY);

  const credentials = `${clientId}:${clientSecret}`;
  const basicAuth = `Basic ${Buffer.from(credentials).toString("base64")}`;

  // Test 1: Basic Auth against token endpoint (with fake code)
  let basicAuthResult: { status: number; body: string } | { error: string };
  try {
    const resp = await fetch("https://oauth2.sky.blackbaud.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: basicAuth,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "fake_diagnostic_code",
        redirect_uri: `${process.env.NEXT_PUBLIC_SITE_URL || "https://www.myteamnetwork.com"}/api/blackbaud/callback`,
      }),
    });
    const text = await resp.text();
    basicAuthResult = { status: resp.status, body: text };
  } catch (err) {
    basicAuthResult = { error: err instanceof Error ? err.message : String(err) };
  }

  // Test 2: Subscription key against API
  let subKeyResult: { status: number; body: string } | { error: string };
  try {
    const resp = await fetch("https://api.sky.blackbaud.com/constituent/v1/constituents?limit=1", {
      headers: {
        "Bb-Api-Subscription-Key": subscriptionKey,
      },
    });
    const text = await resp.text();
    subKeyResult = { status: resp.status, body: text.substring(0, 200) };
  } catch (err) {
    subKeyResult = { error: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json({
    envCheck: {
      clientIdLen: clientId.length,
      clientIdPrefix: clientId.substring(0, 8),
      clientSecretLen: clientSecret.length,
      secretPrefix: clientSecret.substring(0, 4) + "...",
      subscriptionKeyLen: subscriptionKey.length,
      subKeyPrefix: subscriptionKey.substring(0, 8),
      rawClientIdLen: (process.env.BLACKBAUD_CLIENT_ID ?? "").length,
      rawSecretLen: (process.env.BLACKBAUD_CLIENT_SECRET ?? "").length,
    },
    basicAuthTest: basicAuthResult,
    subscriptionKeyTest: subKeyResult,
  });
}
