import Stripe from "stripe";
import type { AlumniBucket, SubscriptionInterval } from "@/types/database";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  throw new Error("STRIPE_SECRET_KEY is not configured");
}

export const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2025-11-17.clover",
  typescript: true,
});

/**
 * Price mapping: environment-driven price IDs for base app and alumni add-ons.
 * Update the STRIPE_PRICE_* env vars to change billing without code changes.
 */
type PriceMap = Record<SubscriptionInterval, string>;

const basePrices: PriceMap = {
  month: process.env.STRIPE_PRICE_BASE_MONTHLY || "",
  year: process.env.STRIPE_PRICE_BASE_YEARLY || "",
};

const alumniPrices: Record<Exclude<AlumniBucket, "none" | "1500+">, PriceMap> = {
  "0-200": {
    month: process.env.STRIPE_PRICE_ALUMNI_0_200_MONTHLY || "",
    year: process.env.STRIPE_PRICE_ALUMNI_0_200_YEARLY || "",
  },
  "201-600": {
    month: process.env.STRIPE_PRICE_ALUMNI_201_600_MONTHLY || "",
    year: process.env.STRIPE_PRICE_ALUMNI_201_600_YEARLY || "",
  },
  "601-1500": {
    month: process.env.STRIPE_PRICE_ALUMNI_601_1500_MONTHLY || "",
    year: process.env.STRIPE_PRICE_ALUMNI_601_1500_YEARLY || "",
  },
};

function requirePriceId(id: string, label: string) {
  if (!id) {
    throw new Error(`Stripe price id missing for ${label}`);
  }
  return id;
}

export function getPriceIds(interval: SubscriptionInterval, alumniBucket: AlumniBucket) {
  const basePrice = requirePriceId(basePrices[interval], `base ${interval}`);
  if (alumniBucket === "none" || alumniBucket === "1500+") {
    return { basePrice, alumniPrice: null as string | null };
  }

  const addOn = alumniPrices[alumniBucket];
  const alumniPrice = requirePriceId(addOn[interval], `alumni ${alumniBucket} ${interval}`);
  return { basePrice, alumniPrice };
}

export function isSalesLedBucket(bucket: AlumniBucket) {
  return bucket === "1500+";
}

export const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;


