import Stripe from "stripe";
import type { AlumniBucket, SubscriptionInterval } from "@/types/database";
import { requireEnv } from "./env";

const stripeSecretKey = requireEnv("STRIPE_SECRET_KEY");
const stripePublishableKey = requireEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
const supabaseUrlForAudit = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKeyForAudit = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const supabaseServiceRoleForAudit = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const priceEnv = {
  STRIPE_PRICE_BASE_MONTHLY: requireEnv("STRIPE_PRICE_BASE_MONTHLY"),
  STRIPE_PRICE_BASE_YEARLY: requireEnv("STRIPE_PRICE_BASE_YEARLY"),
  STRIPE_PRICE_ALUMNI_0_200_MONTHLY: requireEnv("STRIPE_PRICE_ALUMNI_0_200_MONTHLY"),
  STRIPE_PRICE_ALUMNI_0_200_YEARLY: requireEnv("STRIPE_PRICE_ALUMNI_0_200_YEARLY"),
  STRIPE_PRICE_ALUMNI_201_600_MONTHLY: requireEnv("STRIPE_PRICE_ALUMNI_201_600_MONTHLY"),
  STRIPE_PRICE_ALUMNI_201_600_YEARLY: requireEnv("STRIPE_PRICE_ALUMNI_201_600_YEARLY"),
  STRIPE_PRICE_ALUMNI_601_1500_MONTHLY: requireEnv("STRIPE_PRICE_ALUMNI_601_1500_MONTHLY"),
  STRIPE_PRICE_ALUMNI_601_1500_YEARLY: requireEnv("STRIPE_PRICE_ALUMNI_601_1500_YEARLY"),
} as const;

function validatePriceIds() {
  Object.entries(priceEnv).forEach(([key, value]) => {
    if (!value || value.trim() === "") {
      throw new Error(`Invalid Stripe price id for ${key}: <empty>`);
    }
    if (!value.startsWith("price_") || value.startsWith("cs_") || value.startsWith("prod_")) {
      throw new Error(`Invalid Stripe price id for ${key}: ${value}`);
    }
  });
}

validatePriceIds();

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
  month: priceEnv.STRIPE_PRICE_BASE_MONTHLY,
  year: priceEnv.STRIPE_PRICE_BASE_YEARLY,
};

const alumniPrices: Record<Exclude<AlumniBucket, "none" | "1500+">, PriceMap> = {
  "0-200": {
    month: priceEnv.STRIPE_PRICE_ALUMNI_0_200_MONTHLY,
    year: priceEnv.STRIPE_PRICE_ALUMNI_0_200_YEARLY,
  },
  "201-600": {
    month: priceEnv.STRIPE_PRICE_ALUMNI_201_600_MONTHLY,
    year: priceEnv.STRIPE_PRICE_ALUMNI_201_600_YEARLY,
  },
  "601-1500": {
    month: priceEnv.STRIPE_PRICE_ALUMNI_601_1500_MONTHLY,
    year: priceEnv.STRIPE_PRICE_ALUMNI_601_1500_YEARLY,
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

export const STRIPE_PUBLISHABLE_KEY = stripePublishableKey;

const shouldLogEnvAudit = process.env.NODE_ENV !== "production";
let envAuditLogged = false;

if (shouldLogEnvAudit && !envAuditLogged) {
  void supabaseUrlForAudit;
  void supabaseAnonKeyForAudit;
  void supabaseServiceRoleForAudit;
  console.info("✅ All required env vars present");
  console.info("✅ All Stripe Price IDs valid");
  console.info("✅ Supabase keys loaded successfully");
  envAuditLogged = true;
}


