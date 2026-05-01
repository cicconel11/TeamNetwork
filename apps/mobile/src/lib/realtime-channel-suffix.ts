/**
 * Supabase reuses RealtimeChannel instances by topic string. Two subscriptions with the
 * same channel name cause `.on(...)` after `subscribe()` on the shared channel — use a
 * unique suffix per subscriber instance.
 */
export function createRealtimeChannelSuffix(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `rt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
