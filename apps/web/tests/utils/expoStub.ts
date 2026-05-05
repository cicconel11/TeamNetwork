import type { ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import type { ExpoPushClient } from "../../src/lib/notifications/push.ts";

const CHUNK_SIZE = 100;

type TicketOverride = Partial<ExpoPushTicket> & { status: "ok" | "error" };

export interface ExpoStub extends ExpoPushClient {
  /** Every message Expo would have sent, in order, across all chunks. */
  readonly messages: ExpoPushMessage[];
  /** Override the ticket returned for a specific Expo push token. */
  setTicket(token: string, ticket: TicketOverride): void;
  /** Throw on the next sendPushNotificationsAsync call (then reset). */
  failNextSend(error: Error): void;
}

/**
 * Minimal in-memory Expo client. Records every message it would have sent and
 * returns a `status: "ok"` ticket by default. Tests can override per-token
 * tickets to simulate DeviceNotRegistered / MessageRateExceeded / etc.
 */
export function createExpoStub(): ExpoStub {
  const messages: ExpoPushMessage[] = [];
  const ticketOverrides = new Map<string, TicketOverride>();
  let pendingError: Error | null = null;

  return {
    messages,
    setTicket(token, ticket) {
      ticketOverrides.set(token, ticket);
    },
    failNextSend(error) {
      pendingError = error;
    },
    chunkPushNotifications(input) {
      const chunks: ExpoPushMessage[][] = [];
      for (let i = 0; i < input.length; i += CHUNK_SIZE) {
        chunks.push(input.slice(i, i + CHUNK_SIZE));
      }
      return chunks;
    },
    async sendPushNotificationsAsync(chunk) {
      if (pendingError) {
        const err = pendingError;
        pendingError = null;
        throw err;
      }
      const tickets: ExpoPushTicket[] = [];
      for (const message of chunk) {
        messages.push(message);
        const token = String(message.to);
        const override = ticketOverrides.get(token);
        if (override) {
          tickets.push(override as ExpoPushTicket);
        } else {
          tickets.push({ status: "ok", id: `tk-${messages.length}` } as ExpoPushTicket);
        }
      }
      return tickets;
    },
  };
}
