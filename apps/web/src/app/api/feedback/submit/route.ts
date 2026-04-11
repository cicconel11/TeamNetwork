import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  checkRateLimit,
  buildRateLimitResponse,
} from "@/lib/security/rate-limit";
import {
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import { isAnonymousFrictionAllowed } from "@/lib/feedback/anonymous-friction";
import { frictionFeedbackSubmitSchema } from "@/lib/schemas/friction-feedback-submit";
import type { Json } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FORM_ID = "00000000-0000-0000-0000-000000000001"; // Friction Feedback form UUID
const HOUR_MS = 60 * 60 * 1000;

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = process.env.FROM_EMAIL || "noreply@myteamnetwork.com";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@myteamnetwork.com";

interface FeedbackResponses {
  message: string;
  screenshot_url: string | null;
  page_url: string;
  user_agent: string;
  context: string;
  trigger: string;
}

async function sendAdminNotification(
  userEmail: string | null,
  userId: string | null,
  responses: FeedbackResponses,
): Promise<{ success: boolean; error?: string }> {
  const who = userEmail || "Anonymous";
  const idLabel = userId ?? "anonymous";
  const subject = `[Feedback] New friction report from ${who}`;
  const body = `
New feedback submission received:

User: ${who} (${idLabel})
Page: ${responses.page_url}
Context: ${responses.context}
Trigger: ${responses.trigger}

Message:
${responses.message}

${responses.screenshot_url ? `Screenshot: ${responses.screenshot_url}` : "No screenshot provided"}

User Agent: ${responses.user_agent}
  `.trim();

  if (resend) {
    try {
      const response = await resend.emails.send({
        from: FROM_EMAIL,
        to: ADMIN_EMAIL,
        subject,
        text: body,
      });

      if (response.error) {
        return { success: false, error: response.error.message };
      }

      return { success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: errorMsg };
    }
  }

  // Stub for development
  console.log("[STUB] Would send admin notification:", {
    to: ADMIN_EMAIL,
    subject,
    body: body.substring(0, 200) + "...",
  });
  return { success: true };
}

export async function POST(request: Request) {
  let respond:
    | ((
        payload: unknown,
        status?: number,
      ) => ReturnType<typeof NextResponse.json>)
    | null = null;

  try {
    const supabase = await createClient();
    const serviceSupabase = createServiceClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const body = await validateJson(request, frictionFeedbackSubmitSchema, {
      maxBodyBytes: 50_000,
    });
    const { message, screenshot_url, page_url, user_agent, context, trigger } =
      body;

    const anonymousOk = !user && isAnonymousFrictionAllowed(context, trigger);
    if (!user && !anonymousOk) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(request, {
      userId: user?.id ?? null,
      feature: anonymousOk ? "feedback submission (anonymous)" : "feedback submission",
      limitPerIp: anonymousOk ? 5 : 10,
      limitPerUser: anonymousOk ? 0 : 5,
      windowMs: HOUR_MS,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    // Get user's primary organization (if any) for the form_submissions FK
    const { data: membership } = user
      ? await supabase
          .from("user_organization_roles")
          .select("organization_id")
          .eq("user_id", user.id)
          .eq("status", "active")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle()
      : { data: null as null };

    // Build the responses JSONB payload
    const responses: FeedbackResponses = {
      message,
      screenshot_url: screenshot_url ?? null,
      page_url,
      user_agent,
      context,
      trigger,
    };

    // Store feedback - use service client to bypass RLS
    // Note: form_submissions requires organization_id and form_id FK
    // If user has no org, we'll use a placeholder approach
    const { data: submission, error: insertError } = await serviceSupabase
      .from("form_submissions")
      .insert({
        form_id: FORM_ID,
        organization_id:
          membership?.organization_id ?? "00000000-0000-0000-0000-000000000000",
        user_id: user?.id ?? null,
        data: responses as unknown as Json,
        submitted_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("[feedback/submit] Database error:", insertError);
      return respond({ error: "Failed to save feedback" }, 500);
    }

    // Send admin notification (non-blocking - don't fail the request if email fails)
    const emailResult = await sendAdminNotification(
      user?.email ?? null,
      user?.id ?? null,
      responses,
    );
    if (!emailResult.success) {
      console.error(
        "[feedback/submit] Email notification failed:",
        emailResult.error,
      );
    }

    return respond({
      success: true,
      submissionId: submission.id,
    });
  } catch (err) {
    console.error("[feedback/submit] Error:", err);

    if (err instanceof ValidationError) {
      if (respond) {
        return respond(
          {
            error: err.message,
            details: err.details,
          },
          400,
        );
      }
      return validationErrorResponse(err);
    }

    return NextResponse.json(
      { error: "Failed to submit feedback" },
      { status: 500 },
    );
  }
}
