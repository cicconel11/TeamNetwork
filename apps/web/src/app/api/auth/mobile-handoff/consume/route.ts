import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import {
  decryptMobileHandoffToken,
  hashMobileHandoffCode,
} from "@/lib/auth/mobile-oauth";
import {
  consumeMobileHandoff,
  resolveHandoffEnv,
} from "@/lib/auth/mobile-handoff";
import {
  checkRateLimit,
  buildRateLimitResponse,
  deriveClientIp,
} from "@/lib/security/rate-limit";

const requestSchema = z.object({
  code: z.string().min(32).max(256),
});

export async function POST(request: Request) {
  // Unauthenticated endpoint (the native app has no session yet), so guard it
  // by IP. The one-time code is a 256-bit secret so brute force is infeasible;
  // this limit only caps the decrypt/DB work an abusive caller can trigger.
  // Generous enough for a legitimate retry burst or a shared IP at a team signup.
  const rateLimit = checkRateLimit(request, {
    limitPerIp: 30,
    windowMs: 60_000,
    feature: "mobile sign-in",
  });
  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid handoff code" }, { status: 400 });
  }

  const result = await consumeMobileHandoff({
    serviceClient: createServiceClient(),
    codeHash: hashMobileHandoffCode(parsed.data.code),
    decrypt: decryptMobileHandoffToken,
    // Safe, non-secret context for any failure log the core emits.
    logContext: { env: resolveHandoffEnv(), ip: deriveClientIp(request) },
  });

  switch (result.status) {
    case "ok":
      return NextResponse.json({
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
      });
    case "not_found":
      return NextResponse.json(
        { error: "Invalid or expired handoff code" },
        { status: 400 }
      );
    case "rpc_error":
    case "decrypt_error":
      return NextResponse.json({ error: "Unable to consume handoff" }, { status: 500 });
  }
}
