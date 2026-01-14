import type { AlumniBucket, SubscriptionInterval } from "@teammeet/types";

/**
 * Base subscription prices per interval.
 */
export const BASE_PRICES = {
  month: 15,
  year: 150,
} as const;

/**
 * Add-on prices for alumni tiers.
 * "none" excluded - use 0 for no alumni access.
 */
export const ALUMNI_ADD_ON_PRICES: Record<Exclude<AlumniBucket, "none">, { month: number; year: number }> = {
  "0-250": { month: 10, year: 100 },
  "251-500": { month: 20, year: 200 },
  "501-1000": { month: 35, year: 350 },
  "1001-2500": { month: 60, year: 600 },
  "2500-5000": { month: 100, year: 1000 },
  "5000+": { month: 0, year: 0 },
};

/**
 * Human-readable labels for alumni buckets.
 */
export const ALUMNI_BUCKET_LABELS: Record<AlumniBucket, string> = {
  none: "No alumni access",
  "0-250": "0–250 alumni",
  "251-500": "251–500 alumni",
  "501-1000": "501–1,000 alumni",
  "1001-2500": "1,001–2,500 alumni",
  "2500-5000": "2,500–5,000 alumni",
  "5000+": "5,000+ alumni (custom)",
};

/**
 * Maximum alumni count for each bucket.
 * null means unlimited (custom pricing).
 */
export const ALUMNI_LIMITS: Record<AlumniBucket, number | null> = {
  none: 0,
  "0-250": 250,
  "251-500": 500,
  "501-1000": 1000,
  "1001-2500": 2500,
  "2500-5000": 5000,
  "5000+": null,
};

/**
 * Calculates the total subscription price.
 * Returns null for 5000+ tier (custom pricing).
 */
export function getTotalPrice(interval: SubscriptionInterval, alumniBucket: AlumniBucket): number | null {
  if (alumniBucket === "5000+") return null;
  const base = BASE_PRICES[interval];
  const addon = alumniBucket === "none" ? 0 : ALUMNI_ADD_ON_PRICES[alumniBucket][interval];
  return base + addon;
}

/**
 * Formats a price for display.
 */
export function formatPrice(amount: number, interval: SubscriptionInterval): string {
  return interval === "month" ? `$${amount}/mo` : `$${amount}/yr`;
}

/**
 * Gets the alumni limit for a bucket.
 */
export function getAlumniLimit(bucket: AlumniBucket | null | undefined): number | null {
  if (!bucket || !(bucket in ALUMNI_LIMITS)) return 0;
  return ALUMNI_LIMITS[bucket];
}

/**
 * Normalizes a bucket string to a valid AlumniBucket.
 */
export function normalizeBucket(bucket: string | null | undefined): AlumniBucket {
  const allowed: AlumniBucket[] = ["none", "0-250", "251-500", "501-1000", "1001-2500", "2500-5000", "5000+"];
  return allowed.includes(bucket as AlumniBucket) ? (bucket as AlumniBucket) : "none";
}
