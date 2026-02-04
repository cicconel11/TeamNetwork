import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/notifications";

// Note: error_groups table is defined in migration, types need regeneration.
// After running `supabase db push` and `supabase gen types`, type assertions can be removed.

// Notification cooldown periods (in milliseconds)
const FIRST_OCCURRENCE_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours
const SPIKE_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

// Spike detection thresholds
const SPIKE_COUNT_THRESHOLD = 50; // More than 50 errors in 1 hour
const SPIKE_BASELINE_MULTIPLIER = 2; // Must be 2x baseline rate

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@myteamnetwork.com";

interface ErrorGroup {
  id: string;
  fingerprint: string;
  title: string;
  severity: string;
  env: string;
  status: string;
  total_count: number;
  count_1h: number;
  count_24h: number;
  baseline_rate_1h: number | null;
  spike_threshold_1h: number | null;
  first_seen_at: string;
  last_seen_at: string;
  first_notified_at: string | null;
  last_notified_at: string | null;
  sample_event: {
    name?: string;
    message: string;
    normalizedMessage?: string;
    stack?: string;
    route?: string;
    apiPath?: string;
    topFrame?: string | null;
    userId?: string | null;
    sessionId?: string | null;
    severity?: string;
    meta?: Record<string, unknown>;
    capturedAt?: string;
  };
}

type NotifyReason = "first_occurrence" | "spike";

/**
 * Check if notification should be sent and send if appropriate.
 * This function is designed to be called fire-and-forget after error capture.
 *
 * @param groupId - The error group ID to check
 */
export async function checkAndNotify(groupId: string): Promise<void> {
  const supabase = createServiceClient();

  // Fetch the error group
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: group, error: fetchError } = await (supabase.from as any)("error_groups")
    .select("*")
    .eq("id", groupId)
    .single();

  if (fetchError || !group) {
    console.error("[error-notify] Failed to fetch error group:", fetchError);
    return;
  }

  const errorGroup = group as ErrorGroup;

  // Skip notification for non-production or muted/ignored errors
  if (errorGroup.env !== "production") {
    return;
  }

  if (errorGroup.status === "muted" || errorGroup.status === "ignored") {
    return;
  }

  const now = Date.now();
  const shouldNotify = determineNotifyReason(errorGroup, now);

  if (!shouldNotify) {
    return;
  }

  // Send notification
  const emailSent = await sendErrorNotification(errorGroup, shouldNotify.reason);

  if (emailSent) {
    // Update notification timestamps
    const updateData: Record<string, string> = {
      last_notified_at: new Date().toISOString(),
    };

    if (!errorGroup.first_notified_at) {
      updateData.first_notified_at = updateData.last_notified_at;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from as any)("error_groups").update(updateData).eq("id", groupId);
  }
}

function determineNotifyReason(
  group: ErrorGroup,
  now: number
): { reason: NotifyReason } | null {
  // First occurrence notification
  if (!group.first_notified_at && group.total_count === 1) {
    return { reason: "first_occurrence" };
  }

  // Check cooldown
  if (group.last_notified_at) {
    const lastNotified = new Date(group.last_notified_at).getTime();
    const cooldown =
      group.first_notified_at === group.last_notified_at
        ? FIRST_OCCURRENCE_COOLDOWN_MS
        : SPIKE_COOLDOWN_MS;

    if (now - lastNotified < cooldown) {
      return null; // Still in cooldown
    }
  }

  // Spike detection
  const isSpike = detectSpike(group);
  if (isSpike) {
    return { reason: "spike" };
  }

  return null;
}

function detectSpike(group: ErrorGroup): boolean {
  const count1h = group.count_1h;
  const threshold = group.spike_threshold_1h ?? SPIKE_COUNT_THRESHOLD;
  const baseline = group.baseline_rate_1h ?? 0;

  // Must exceed threshold count
  if (count1h <= threshold) {
    return false;
  }

  // If we have a baseline, must be significantly above it
  if (baseline > 0 && count1h <= baseline * SPIKE_BASELINE_MULTIPLIER) {
    return false;
  }

  return true;
}

async function sendErrorNotification(
  group: ErrorGroup,
  reason: NotifyReason
): Promise<boolean> {
  const subject = buildSubject(group, reason);
  const body = buildEmailBody(group, reason);

  const result = await sendEmail({
    to: ADMIN_EMAIL,
    subject,
    body,
  });

  if (!result.success) {
    console.error("[error-notify] Failed to send email:", result.error);
    return false;
  }

  return true;
}

function buildSubject(group: ErrorGroup, reason: NotifyReason): string {
  const prefix = reason === "first_occurrence" ? "[NEW ERROR]" : `[SPIKE]`;
  const countSuffix = reason === "spike" ? ` (${group.count_1h}/hour)` : "";

  // Truncate title for subject line
  const maxTitleLength = 60;
  let title = group.title;
  if (title.length > maxTitleLength) {
    title = title.slice(0, maxTitleLength - 3) + "...";
  }

  return `${prefix} ${title}${countSuffix}`;
}

function buildEmailBody(group: ErrorGroup, reason: NotifyReason): string {
  const event = group.sample_event;
  const alertType = reason === "first_occurrence" ? "New Error" : "Spike Detected";

  const lines: string[] = [
    `Error Alert: ${alertType}`,
    "",
    `Title: ${group.title}`,
    `Severity: ${group.severity.toUpperCase()}`,
    `Fingerprint: ${group.fingerprint}`,
    "",
    "Counts:",
    `- Last hour: ${group.count_1h}`,
    `- Last 24h: ${group.count_24h}`,
    `- Total: ${group.total_count}`,
    "",
    `Environment: ${group.env}`,
    `Route: ${event.route || "N/A"}`,
    `API Path: ${event.apiPath || "N/A"}`,
    `Deployment: ${(event.meta?.deploymentId as string) || "N/A"}`,
    "",
    `User ID: ${event.userId || "anonymous"}`,
    `Session ID: ${event.sessionId || "N/A"}`,
    "",
    "Error Message:",
    event.message,
    "",
  ];

  if (event.stack) {
    lines.push("Stack Trace:");
    // Truncate stack for email
    const stackLines = event.stack.split("\n").slice(0, 15);
    lines.push(...stackLines);
    if (event.stack.split("\n").length > 15) {
      lines.push("... (truncated)");
    }
    lines.push("");
  }

  lines.push(`First seen: ${group.first_seen_at}`);
  lines.push(`Last seen: ${group.last_seen_at}`);

  return lines.join("\n");
}
