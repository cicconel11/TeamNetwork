"use client";

import type { UIProfile } from "./types";

/**
 * Disabled for now: self-evolving AI profile generation is intentionally off.
 * Returns null so UI renders default ordering without personalization.
 */
export function useUIProfile(): {
  profile: UIProfile | null;
  loading: boolean;
} {
  return { profile: null, loading: false };
}
