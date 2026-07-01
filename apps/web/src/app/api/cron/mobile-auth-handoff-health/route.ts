import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";
import { sendEmail } from "@/lib/notifications";
import {
  computeHandoffHealth,
  evaluateHandoffHealth,
} from "@/lib/mobile-auth-health/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Hourly cron: mobile-auth handoff create-vs-consume health signal.
 *
 * Detects the "37 created / 3 consumed" regression signature — many one-time
 * handoff codes minted on web but almost none consumed on mobile — and pages
 * via email instead of requiring a manual Supabase query.
 *
 * Web has no Sentry; email (Resend, with a console.info stub when
 * RESEND_API_KEY is unset) is the paging channel. Recipients resolve from
 * ALERT_EMAIL_TO (comma-list) -> ADMIN_EMAIL fallback.
 *
 * Cooldown: an active incident here is rare, so we accept one email per hourly
 * run while it persists (a page an hour is fine and, arguably, desirable for an
 * ongoing outage). We deliberately do NOT stash alert state on the
 * `mobile_auth_handoffs` rows.
 * follow-up: if hourly pages during a long incident prove noisy, add a tiny
 * dedicated cooldown store (one-row table or env-configured last-notified),
 * mirroring lib/errors/notify.ts's row-based cooldown.
 *
 * No tokens, code hashes, or PII are read or logged — only aggregate counts and
 * the window bounds. The count queries are head-only (no rows fetched).
 */

function getAlertRecipients(): string[] {
  const alertEmail = process.env.ALERT_EMAIL_TO;
  if (alertEmail) {
    return alertEmail
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean);
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    return [adminEmail];
  }

  return [];
}

export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const supabase = createServiceClient();

  const { data, error } = await computeHandoffHealth(supabase);
  if (error || !data) {
    console.error(
      "[cron/mobile-auth-handoff-health] Failed to compute handoff health:",
      error?.message ?? "no data returned"
    );
    return NextResponse.json(
      { error: "Failed to compute handoff health" },
      { status: 500 }
    );
  }

  const { created, consumed, windowStart } = data;
  const verdict = evaluateHandoffHealth({ created, consumed });

  if (!verdict.alert) {
    console.info(
      `[cron/mobile-auth-handoff-health] healthy: created=${created} consumed=${consumed} (${verdict.reason})`
    );
    return NextResponse.json({ created, consumed, alerted: false });
  }

  const recipients = getAlertRecipients();
  if (recipients.length === 0) {
    console.warn(
      `[cron/mobile-auth-handoff-health] alert condition met (created=${created} consumed=${consumed}) but no recipients configured (ALERT_EMAIL_TO or ADMIN_EMAIL)`
    );
    return NextResponse.json({
      created,
      consumed,
      alerted: false,
      warning: "No alert recipients configured",
    });
  }

  const subject = `[TeamMeet] Mobile sign-in handoff regression: ${consumed}/${created} consumed`;
  const body = [
    "Mobile-auth handoff health check tripped the create-vs-consume alert.",
    "",
    `Window start: ${windowStart}`,
    `Codes created: ${created}`,
    `Codes consumed: ${consumed}`,
    `Consume ratio: ${verdict.ratio.toFixed(2)}`,
    `Reason: ${verdict.reason}`,
    "",
    "Many web->mobile sign-in codes are being minted but not consumed on the",
    "native app. Check the consume route (/api/auth/mobile-handoff/consume) and",
    "recent mobile auth releases.",
  ].join("\n");

  const results = await Promise.all(
    recipients.map((to) => sendEmail({ to, subject, body }))
  );

  const failed = results.filter((r) => !r.success);
  if (failed.length > 0) {
    console.error(
      `[cron/mobile-auth-handoff-health] failed to send ${failed.length}/${recipients.length} alert email(s):`,
      failed.map((r) => r.error).join("; ")
    );
  } else {
    console.info(
      `[cron/mobile-auth-handoff-health] alert sent to ${recipients.length} recipient(s): created=${created} consumed=${consumed}`
    );
  }

  return NextResponse.json({ created, consumed, alerted: failed.length < results.length });
}
