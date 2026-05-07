import type { ErrorGroup } from "./queries";

const SEPARATOR = "────────────────────────────────────────";

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function truncateTitle(title: string, maxLength: number = 50): string {
  if (title.length <= maxLength) return title;
  return title.substring(0, maxLength - 3) + "...";
}

function getSeverityLabel(severity: ErrorGroup["severity"]): string {
  return `[${severity.toUpperCase()}]`;
}

function extractSampleEventDetails(sampleEvent: Record<string, unknown>): {
  message?: string;
  route?: string;
  apiPath?: string;
  stack?: string;
} {
  return {
    message: typeof sampleEvent.message === "string" ? sampleEvent.message : undefined,
    route: typeof sampleEvent.route === "string" ? sampleEvent.route : undefined,
    apiPath: typeof sampleEvent.api_path === "string" ? sampleEvent.api_path : undefined,
    stack: typeof sampleEvent.stack === "string" ? sampleEvent.stack : undefined,
  };
}

export interface NewErrorEmailContent {
  subject: string;
  body: string;
}

/**
 * Generate email content for a new error notification
 */
export function buildNewErrorEmail(group: ErrorGroup): NewErrorEmailContent {
  const severityLabel = getSeverityLabel(group.severity);
  const truncatedTitle = truncateTitle(group.title);
  const { message, route, apiPath, stack } = extractSampleEventDetails(group.sample_event);

  const subject = `${severityLabel} New Error: ${truncatedTitle}`;

  const lines: string[] = [
    `A new error has been detected in ${group.env}:`,
    "",
    `${severityLabel} ${group.title}`,
    SEPARATOR,
    `Environment: ${group.env}`,
    `Severity: ${group.severity}`,
    `First Seen: ${formatDate(group.first_seen_at)}`,
    `Occurrences: ${group.total_count}`,
  ];

  if (message) {
    lines.push("", `Message: ${message}`);
  }

  if (route) {
    lines.push(`Route: ${route}`);
  }

  if (apiPath) {
    lines.push(`API Path: ${apiPath}`);
  }

  if (stack) {
    lines.push("", "Stack Trace:", stack);
  }

  lines.push(SEPARATOR, `Fingerprint: ${group.fingerprint}`);

  const body = lines.join("\n");

  return { subject, body };
}

export interface SpikeAlertEmailContent {
  subject: string;
  body: string;
}

/**
 * Generate email content for a spike alert notification
 */
export function buildSpikeAlertEmail(group: ErrorGroup): SpikeAlertEmailContent {
  const severityLabel = getSeverityLabel(group.severity);
  const truncatedTitle = truncateTitle(group.title);
  const { message, route, apiPath, stack } = extractSampleEventDetails(group.sample_event);

  const subject = `${severityLabel} Error Spike: ${truncatedTitle} (${group.count_1h} in 1hr)`;

  const lines: string[] = [
    `Error spike detected in ${group.env}:`,
    "",
    `${severityLabel} ${group.title}`,
    SEPARATOR,
    `Environment: ${group.env}`,
    `Severity: ${group.severity}`,
    "",
    "Rate Spike Detected:",
    `- Last Hour: ${group.count_1h} occurrences`,
    `- Last 24 Hours: ${group.count_24h} occurrences`,
    `- Total: ${group.total_count} occurrences`,
    "",
    `First Seen: ${formatDate(group.first_seen_at)}`,
    `Last Seen: ${formatDate(group.last_seen_at)}`,
  ];

  if (message) {
    lines.push("", `Message: ${message}`);
  }

  if (route) {
    lines.push(`Route: ${route}`);
  }

  if (apiPath) {
    lines.push(`API Path: ${apiPath}`);
  }

  if (stack) {
    lines.push("", "Stack Trace:", stack);
  }

  lines.push(SEPARATOR, `Fingerprint: ${group.fingerprint}`);

  const body = lines.join("\n");

  return { subject, body };
}

export type NotificationType = "new" | "spike";

/**
 * Determine the notification type for an error group
 */
export function getNotificationType(group: ErrorGroup): NotificationType {
  if (group.first_notified_at === null) {
    return "new";
  }
  return "spike";
}

/**
 * Build email content based on notification type
 */
export function buildEmailContent(
  group: ErrorGroup,
  type: NotificationType
): { subject: string; body: string } {
  if (type === "new") {
    return buildNewErrorEmail(group);
  }
  return buildSpikeAlertEmail(group);
}
