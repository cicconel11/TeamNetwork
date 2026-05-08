import { useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

/**
 * Reactive "now" — re-renders the consumer on a tick interval.
 *
 * Cadence auto-tunes from `targetAt` (event start/end). Pauses while the app
 * is backgrounded; snaps to the current wall clock on resume.
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

    function onAppStateChange(state: AppStateStatus) {
      if (state === "active") start();
      else stop();
    }

    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", onAppStateChange);

    return () => {
      stop();
      sub.remove();
    };
  }, [targetAt]);

  return now;
}
