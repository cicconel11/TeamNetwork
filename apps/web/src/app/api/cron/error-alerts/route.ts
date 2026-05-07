import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/notifications";
import {
  fetchGroupsNeedingNotification,
  updateNotificationTimestamps,
  type ErrorGroup,
} from "@/lib/error-alerts/queries";
import {
  buildEmailContent,
  getNotificationType,
  type NotificationType,
} from "@/lib/error-alerts/templates";
import { validateCronAuth } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";

const SPIKE_THRESHOLD = 10;
const SPIKE_COOLDOWN_HOURS = 1;
const MAX_BATCH_SIZE = 50;

function getAlertRecipients(): string[] {
  const alertEmail = process.env.ALERT_EMAIL_TO;
  if (alertEmail) {
    return alertEmail.split(",").map((email) => email.trim()).filter(Boolean);
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    return [adminEmail];
  }

  return [];
}

interface ProcessResult {
  id: string;
  type: NotificationType;
  success: boolean;
  error?: string;
}

async function processErrorGroup(
  group: ErrorGroup,
  recipients: string[]
): Promise<ProcessResult> {
  const type = getNotificationType(group);
  const { subject, body } = buildEmailContent(group, type);

  const results: { success: boolean; error?: string }[] = [];

  for (const recipient of recipients) {
    const result = await sendEmail({ to: recipient, subject, body });
    results.push(result);
  }

  const allSucceeded = results.every((r) => r.success);
  const firstError = results.find((r) => !r.success)?.error;

  return {
    id: group.id,
    type,
    success: allSucceeded,
    error: firstError,
  };
}

export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const recipients = getAlertRecipients();
  if (recipients.length === 0) {
    console.warn("[error-alerts-cron] No alert recipients configured (ALERT_EMAIL_TO or ADMIN_EMAIL)");
    return NextResponse.json({
      processed: 0,
      newErrors: 0,
      spikes: 0,
      results: [],
      warning: "No alert recipients configured",
    });
  }

  const serviceClient = createServiceClient();

  const { data: groups, error } = await fetchGroupsNeedingNotification(serviceClient, {
    spikeThreshold: SPIKE_THRESHOLD,
    spikeCooldownHours: SPIKE_COOLDOWN_HOURS,
    maxBatchSize: MAX_BATCH_SIZE,
  });

  if (error) {
    console.error("[error-alerts-cron] Failed to fetch error groups:", error);
    return NextResponse.json(
      { error: "Database error", message: "Failed to fetch error groups." },
      { status: 500 }
    );
  }

  const results: ProcessResult[] = [];
  let newErrorCount = 0;
  let spikeCount = 0;

  for (const group of groups) {
    const result = await processErrorGroup(group, recipients);
    results.push(result);

    if (result.type === "new") {
      newErrorCount += 1;
    } else {
      spikeCount += 1;
    }

    if (result.success) {
      const isFirstNotification = group.first_notified_at === null;
      const updateResult = await updateNotificationTimestamps(serviceClient, group.id, {
        isFirstNotification,
      });

      if (updateResult.error) {
        console.error(
          `[error-alerts-cron] Failed to update timestamps for group ${group.id}:`,
          updateResult.error
        );
      }
    } else {
      console.error(
        `[error-alerts-cron] Failed to send notification for group ${group.id}:`,
        result.error
      );
    }
  }

  return NextResponse.json({
    processed: groups.length,
    newErrors: newErrorCount,
    spikes: spikeCount,
    results,
  });
}
