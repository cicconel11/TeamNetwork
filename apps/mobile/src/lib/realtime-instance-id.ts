import { useRef } from "react";

/**
 * One random suffix for a Realtime `channel()` name. Extracted for tests.
 */
export function generateRealtimeChannelInstanceSuffix(): string {
  const c = globalThis.crypto;
  return c && typeof c.randomUUID === "function"
    ? c.randomUUID()
    : `rt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Stable id per hook / screen instance for Realtime `channel()` names.
 * Supabase returns the same channel for duplicate names; calling `.on()`
 * again after `.subscribe()` throws. Unique suffixes avoid collisions when
 * multiple components subscribe to the same logical topic.
 */
export function useRealtimeChannelInstanceSuffix(): string {
  const ref = useRef<string | null>(null);
  if (ref.current === null) {
    ref.current = generateRealtimeChannelInstanceSuffix();
  }
  return ref.current;
}
