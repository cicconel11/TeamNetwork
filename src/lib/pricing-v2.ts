export type Tier = "single" | "enterprise";
export type Interval = "month" | "year";

export interface QuoteInput {
  tier: Tier;
  actives: number;
  alumni: number;
  subOrgs?: number;
}

export interface QuoteBreakdown {
  alumniRateCents: number;
  alumniMonthlyCents: number;
  activeRateCents: number;
  activeMonthlyCents: number;
  platformBaseCents: number;
  subOrgsBilled: number;
  subOrgMonthlyCents: number;
}

export interface QuoteResult {
  salesLed: boolean;
  monthlyCents: number;
  yearlyCents: number;
  breakdown: QuoteBreakdown;
}

export const SALES_LED_ALUMNI_THRESHOLD = 100_000;
export const YEARLY_DISCOUNT_FACTOR = 0.83;

const ENTERPRISE_PLATFORM_BASE_CENTS = 25_000;
const SUB_ORG_FIRST_TIER_CENTS = 2_000;
const SUB_ORG_SECOND_TIER_CENTS = 1_500;
const SUB_ORG_FIRST_TIER_LIMIT = 10;

function alumniRateCents(alumni: number): number {
  if (alumni <= 0) return 0;
  if (alumni <= 500) return 36;
  if (alumni <= 2_500) return 25;
  if (alumni <= 10_000) return 18;
  if (alumni <= 25_000) return 13;
  if (alumni <= 50_000) return 11;
  if (alumni <= 75_000) return 9;
  return 7;
}

function activeRateCents(actives: number): number {
  if (actives <= 0) return 0;
  if (actives <= 100) return 15;
  if (actives <= 500) return 10;
  return 5;
}

function zeroBreakdown(): QuoteBreakdown {
  return {
    alumniRateCents: 0,
    alumniMonthlyCents: 0,
    activeRateCents: 0,
    activeMonthlyCents: 0,
    platformBaseCents: 0,
    subOrgsBilled: 0,
    subOrgMonthlyCents: 0,
  };
}

export function quote(input: QuoteInput): QuoteResult {
  const { tier } = input;
  const actives = Math.max(0, Math.floor(input.actives));
  const alumni = Math.max(0, Math.floor(input.alumni));
  const subOrgs = Math.max(0, Math.floor(input.subOrgs ?? 0));

  if (alumni > SALES_LED_ALUMNI_THRESHOLD) {
    return {
      salesLed: true,
      monthlyCents: 0,
      yearlyCents: 0,
      breakdown: zeroBreakdown(),
    };
  }

  const aRate = alumniRateCents(alumni);
  const alumniMonthlyCents = alumni * aRate;

  const acRate = activeRateCents(actives);
  const activeMonthlyCents = actives * acRate;

  const platformBaseCents = tier === "enterprise" ? ENTERPRISE_PLATFORM_BASE_CENTS : 0;

  const subOrgsBilled = tier === "enterprise" ? subOrgs : 0;
  const subOrgMonthlyCents =
    tier === "enterprise"
      ? Math.min(subOrgsBilled, SUB_ORG_FIRST_TIER_LIMIT) * SUB_ORG_FIRST_TIER_CENTS +
        Math.max(0, subOrgsBilled - SUB_ORG_FIRST_TIER_LIMIT) * SUB_ORG_SECOND_TIER_CENTS
      : 0;

  const monthlyCents =
    alumniMonthlyCents + activeMonthlyCents + platformBaseCents + subOrgMonthlyCents;
  const yearlyCents = Math.round(monthlyCents * 12 * YEARLY_DISCOUNT_FACTOR);

  return {
    salesLed: false,
    monthlyCents,
    yearlyCents,
    breakdown: {
      alumniRateCents: aRate,
      alumniMonthlyCents,
      activeRateCents: acRate,
      activeMonthlyCents,
      platformBaseCents,
      subOrgsBilled,
      subOrgMonthlyCents,
    },
  };
}
