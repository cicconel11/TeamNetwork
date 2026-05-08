"use client";

import { useEffect, useState } from "react";

/**
 * Reactive "now" — re-renders the consumer on a tick interval.
 *
 * If `targetAt` is supplied, the cadence auto-tunes:
 *   - within 15 minutes of the target (before or after) -> 1s
 *   - within 1 hour                                      -> 15s
 *   - otherwise                                          -> 60s
 *
 * Pauses while the document is hidden so background tabs don't burn cycles;
 * snaps `now` to the current wall clock on unhide.
 */
export function useNow(targetAt?: string | Date | null): Date {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    function pickInterval(): number {
      if (!targetAt) return 30_000;
      const targetMs =
        typeof targetAt === "string"
          ? Date.parse(targetAt)
          : targetAt.getTime();
      if (!Number.isFinite(targetMs)) return 30_000;
      const deltaMs = Math.abs(targetMs - Date.now());
      if (deltaMs <= 15 * 60 * 1000) return 1_000;
      if (deltaMs <= 60 * 60 * 1000) return 15_000;
      return 60_000;
    }

    function start() {
      stop();
      setNow(new Date());
      timer = setInterval(() => setNow(new Date()), pickInterval());
    }
    function stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    }

    function handleVisibility() {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible") {
        start();
      } else {
        stop();
      }
    }

    if (typeof document === "undefined" || document.visibilityState === "visible") {
      start();
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }

    return () => {
      stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    };
  }, [targetAt]);

  return now;
}
