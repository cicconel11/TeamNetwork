import type { SubscriptionInterval } from "@teammeet/types";

export type SeatRate = {
  upTo: number | null;
  unitAmountCents: number;
};

export const ACTIVE_TIERS_MONTHLY: SeatRate[] = [
  { upTo: 100, unitAmountCents: 15 },
  { upTo: 500, unitAmountCents: 10 },
  { upTo: null, unitAmountCents: 5 },
];

export const ALUMNI_TIERS_MONTHLY: SeatRate[] = [
  { upTo: 500, unitAmountCents: 36 },
  { upTo: 2_500, unitAmountCents: 25 },
  { upTo: 10_000, unitAmountCents: 18 },
];

export const ACTIVE_TIERS_YEARLY: SeatRate[] = ACTIVE_TIERS_MONTHLY.map((t) => ({
  upTo: t.upTo,
  unitAmountCents: t.unitAmountCents * 10,
}));

export const ALUMNI_TIERS_YEARLY: SeatRate[] = ALUMNI_TIERS_MONTHLY.map((t) => ({
  upTo: t.upTo,
  unitAmountCents: t.unitAmountCents * 10,
}));

export const SALES_LED_ALUMNI_THRESHOLD = 10_000;

export function getActiveTiers(interval: SubscriptionInterval): SeatRate[] {
  return interval === "year" ? ACTIVE_TIERS_YEARLY : ACTIVE_TIERS_MONTHLY;
}

export function getAlumniTiers(interval: SubscriptionInterval): SeatRate[] {
  return interval === "year" ? ALUMNI_TIERS_YEARLY : ALUMNI_TIERS_MONTHLY;
}

export function pickRateCents(tiers: SeatRate[], qty: number): number {
  if (qty <= 0) return tiers[0]?.unitAmountCents ?? 0;
  for (const tier of tiers) {
    if (tier.upTo === null || qty <= tier.upTo) {
      return tier.unitAmountCents;
    }
  }
  return tiers[tiers.length - 1]?.unitAmountCents ?? 0;
}

export function isPerUserSalesLed(alumniSeats: number): boolean {
  return alumniSeats > SALES_LED_ALUMNI_THRESHOLD;
}

export type PerUserQuote = {
  activeRateCents: number;
  alumniRateCents: number;
  activeSubtotalCents: number;
  alumniSubtotalCents: number;
  totalCents: number;
} | null;

export function calcPerUserQuote(
  interval: SubscriptionInterval,
  activeSeats: number,
  alumniSeats: number,
): PerUserQuote {
  if (isPerUserSalesLed(alumniSeats)) return null;
  if (activeSeats < 0 || alumniSeats < 0) return null;

  const activeTiers = getActiveTiers(interval);
  const alumniTiers = getAlumniTiers(interval);

  const activeRateCents = pickRateCents(activeTiers, activeSeats);
  const alumniRateCents = alumniSeats > 0 ? pickRateCents(alumniTiers, alumniSeats) : 0;

  const activeSubtotalCents = activeSeats * activeRateCents;
  const alumniSubtotalCents = alumniSeats * alumniRateCents;

  return {
    activeRateCents,
    alumniRateCents,
    activeSubtotalCents,
    alumniSubtotalCents,
    totalCents: activeSubtotalCents + alumniSubtotalCents,
  };
}

export function formatCents(cents: number): string {
  const dollars = cents / 100;
  if (Number.isInteger(dollars)) return `$${dollars.toFixed(0)}`;
  return `$${dollars.toFixed(2)}`;
}

export function formatRateCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export type LegacyAlumniBucket =
  | "none"
  | "0-250"
  | "251-500"
  | "501-1000"
  | "1001-2500"
  | "2500-5000"
  | "5000+";

export function mapAlumniSeatsToBucket(alumniSeats: number): LegacyAlumniBucket {
  if (alumniSeats <= 0) return "none";
  if (alumniSeats <= 250) return "0-250";
  if (alumniSeats <= 500) return "251-500";
  if (alumniSeats <= 1000) return "501-1000";
  if (alumniSeats <= 2500) return "1001-2500";
  if (alumniSeats <= 5000) return "2500-5000";
  return "5000+";
}
