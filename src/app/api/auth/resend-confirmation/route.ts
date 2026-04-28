import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { baseSchemas, validateJson, ValidationError, validationErrorResponse } from "@/lib/security/validation";
import { verifyCaptcha } from "@/lib/security/captcha";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { buildEmailSignupCallbackUrl, sanitizeRedirectPath } from "@/lib/auth/redirect";
import { debugLog, maskPII } from "@/lib/debug";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const resendSchema = z.object({
  email: baseSchemas.email,
  captchaToken: z.string().trim().min(1, "Captcha token is required"),
  redirect: z.string().optional(),
});

const GENERIC_OK = {
  ok: true,
  message: "If an account exists for that email, a new confirmation link is on its way.",
};

function clientIp(request: Request): string | undefined {
  const headers = request.headers;
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  return undefined;
}

/**
 * POST /api/auth/resend-confirmation
 *
 * Resends the signup confirmation email. Always returns a generic success
 * response (except on captcha/rate-limit failures) to avoid leaking which
 * emails are registered.
 */
export async function POST(request: Request) {
  try {
    const body = await validateJson(request, resendSchema, { maxBodyBytes: 2_000 });

    // Per-IP rate limit: keeps a single attacker from sweeping inboxes.
    const ipLimit = checkRateLimit(request, {
      pathOverride: "/api/auth/resend-confirmation:ip",
      limitPerIp: 5,
      windowMs: 60 * 60 * 1000,
      feature: "the resend confirmation endpoint",
    });
    if (!ipLimit.ok) {
      return NextResponse.json(
        { error: "Too many requests", retryAfterSeconds: ipLimit.retryAfterSeconds },
        { status: 429, headers: ipLimit.headers },
      );
    }

    // Per-email rate limit: prevents spamming a single inbox even from rotating IPs.
    // Keyed via userId field so the limiter buckets on email rather than path.
    const emailLimit = checkRateLimit(request, {
      pathOverride: "/api/auth/resend-confirmation:email",
      limitPerIp: 0,
      limitPerUser: 2,
      userId: body.email.toLowerCase(),
      windowMs: 5 * 60 * 1000,
      feature: "resending confirmation to this email",
    });
    if (!emailLimit.ok) {
      return NextResponse.json(
        { error: "Too many requests", retryAfterSeconds: emailLimit.retryAfterSeconds },
        { status: 429, headers: emailLimit.headers },
      );
    }

    const captcha = await verifyCaptcha(body.captchaToken, clientIp(request));
    if (!captcha.success) {
      return NextResponse.json(
        { error: "Captcha verification failed" },
        { status: 400 },
      );
    }

    const requestUrl = new URL(request.url);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || requestUrl.origin;
    const redirect = sanitizeRedirectPath(body.redirect ?? null);
    const emailRedirectTo = buildEmailSignupCallbackUrl(siteUrl, redirect);

    const supabase = await createClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: body.email,
      options: { emailRedirectTo },
    });

    if (error) {
      // Log but never leak — Supabase returns errors for already-confirmed
      // accounts, unknown emails, and rate limits indistinguishably from a
      // user-experience perspective.
      console.warn("[auth/resend-confirmation] resend failed:", maskPII(body.email), error.message);
    } else {
      debugLog("auth-resend-confirmation", "resent confirmation", { email: maskPII(body.email) });
    }

    return NextResponse.json(GENERIC_OK);
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    console.error("[auth/resend-confirmation] unexpected error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
