/**
 * Expo Push Notification Service
 * Sends push notifications via Expo's push service
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface ExpoPushMessage {
  to: string; // Expo push token
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
  priority?: "default" | "normal" | "high";
  ttl?: number;
}

export interface ExpoPushTicket {
  id?: string;
  status: "ok" | "error";
  message?: string;
  details?: {
    error?: string;
  };
}

export interface ExpoPushResponse {
  data: ExpoPushTicket[];
}

export interface SendPushResult {
  success: boolean;
  sent: number;
  failed: number;
  errors: string[];
}

/**
 * Send push notifications via Expo Push API
 * Handles batching for large lists of recipients
 */
export async function sendExpoPushNotifications(
  messages: ExpoPushMessage[]
): Promise<SendPushResult> {
  if (messages.length === 0) {
    return { success: true, sent: 0, failed: 0, errors: [] };
  }

  const errors: string[] = [];
  let sent = 0;
  let failed = 0;

  // Expo recommends batching up to 100 messages per request
  const batchSize = 100;
  const batches: ExpoPushMessage[][] = [];

  for (let i = 0; i < messages.length; i += batchSize) {
    batches.push(messages.slice(i, i + batchSize));
  }

  for (const batch of batches) {
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      });

      if (!response.ok) {
        const errorText = await response.text();
        errors.push(`Expo Push API error: ${response.status} - ${errorText}`);
        failed += batch.length;
        continue;
      }

      const result: ExpoPushResponse = await response.json();

      for (const ticket of result.data) {
        if (ticket.status === "ok") {
          sent++;
        } else {
          failed++;
          const errorMessage = ticket.details?.error || ticket.message || "Unknown error";
          errors.push(errorMessage);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Network error: ${errorMessage}`);
      failed += batch.length;
    }
  }

  return {
    success: failed === 0,
    sent,
    failed,
    errors: errors.slice(0, 10), // Limit error messages
  };
}

/**
 * Build an Expo push message from notification data
 */
export function buildPushMessage(
  token: string,
  title: string,
  body: string,
  data: Record<string, unknown>
): ExpoPushMessage {
  return {
    to: token,
    title,
    body,
    data,
    sound: "default",
    priority: "high",
    channelId: "default",
  };
}
