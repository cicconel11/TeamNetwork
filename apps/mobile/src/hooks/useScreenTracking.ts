/**
 * Automatic screen tracking via Expo Router
 *
 * Tracks screen views when the pathname changes, deriving a human-readable
 * screen name from the route segments.
 */

import { usePathname, useSegments } from "expo-router";
import { useEffect, useRef } from "react";
import { screen } from "@/lib/analytics";

export function useScreenTracking(): void {
  const pathname = usePathname();
  const segments = useSegments();
  const prevPathRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (pathname !== prevPathRef.current) {
      const screenName = deriveScreenName(segments);
      screen(screenName, { pathname });
      prevPathRef.current = pathname;
    }
  }, [pathname, segments]);
}

/**
 * Derive a human-readable screen name from route segments.
 * Filters out layout groups (parentheses) and dynamic params (brackets).
 */
function deriveScreenName(segments: string[]): string {
  const meaningful = segments.filter(
    (s) => !s.startsWith("(") && !s.startsWith("[")
  );
  return meaningful.length
    ? capitalize(meaningful[meaningful.length - 1])
    : "Home";
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
