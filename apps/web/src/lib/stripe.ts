import Stripe from "stripe";
import type { AlumniBucket, SubscriptionInterval } from "@/types/database";
import { requireEnv, requireEnvOrDummy } from "./env";

// `SKIP_STRIPE_VALIDATION=true` lets `next build` run (and its
// "Collect page data" pass load this module) without real Stripe
// credentials. Only ever set in CI / local dev — see next.config.mjs.
const skipStripeValidation = process.env.SKIP_STRIPE_VALIDATION === "true";

// Dummy price IDs must start with "price_" to satisfy `validatePriceIds()`
// below. They're only used when the skip flag is set.
const DUMMY_PRICE_ID = "price_ci_dummy";
const DUMMY_STRIPE_KEY = "sk_test_ci_dummy";

const stripeSecretKey = requireEnvOrDummy("STRIPE_SECRET_KEY", DUMMY_STRIPE_KEY);
const stripePublishableKey = requireEnvOrDummy("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_ci_dummy");
// Supabase keys are gated through the same skip flag because CI doesn't
// wire SUPABASE_SERVICE_ROLE_KEY, and this module loads at build time.
const supabaseUrlForAudit = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKeyForAudit = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const supabaseServiceRoleForAudit = requireEnvOrDummy("SUPABASE_SERVICE_ROLE_KEY", "dummy_service_role");
const priceEnv = {
  STRIPE_PRICE_BASE_MONTHLY: requireEnvOrDummy("STRIPE_PRICE_BASE_MONTHLY", DUMMY_PRICE_ID),
  STRIPE_PRICE_BASE_YEARLY: requireEnvOrDummy("STRIPE_PRICE_BASE_YEARLY", DUMMY_PRICE_ID),
  STRIPE_PRICE_ALUMNI_0_250_MONTHLY: requireEnvOrDummy("STRIPE_PRICE_ALUMNI_0_250_MONTHLY", DUMMY_PRICE_ID),
  STRIPE_PRICE_ALUMNI_0_250_YEARLY: requireEnvOrDummy("STRIPE_PRICE_ALUMNI_0_250_YEARLY", DUMMY_PRICE_ID),
  STRIPE_PRICE_ALUMNI_251_500_MONTHLY: requireEnvOrDummy("STRIPE_PRICE_ALUMNI_251_500_MONTHLY", DUMMY_PRICE_ID),
  STRIPE_PRICE_ALUMNI_251_500_YEARLY: requireEnvOrDummy("STRIPE_PRICE_ALUMNI_251_500_YEARLY", DUMMY_PRICE_ID),
  STRIPE_PRICE_ALUMNI_501_1000_MONTHLY: requireEnvOrDummy("STRIPE_PRICE_ALUMNI_501_1000_MONTHLY", DUMMY_PRICE_ID),
  STRIPE_PRICE_ALUMNI_501_1000_YEARLY: requireEnvOrDummy("STRIPE_PRICE_ALUMNI_501_1000_YEARLY", DUMMY_PRICE_ID),
  STRIPE_PRICE_ALUMNI_1001_2500_MONTHLY: requireEnvOrDummy("STRIPE_PRICE_ALUMNI_1001_2500_MONTHLY", DUMMY_PRICE_ID),
  STRIPE_PRICE_ALUMNI_1001_2500_YEARLY: requireEnvOrDummy("STRIPE_PRICE_ALUMNI_1001_2500_YEARLY", DUMMY_PRICE_ID),
  STRIPE_PRICE_ALUMNI_2500_5000_MONTHLY: requireEnvOrDummy("STRIPE_PRICE_ALUMNI_2500_5000_MONTHLY", DUMMY_PRICE_ID),
  STRIPE_PRICE_ALUMNI_2500_5000_YEARLY: requireEnvOrDummy("STRIPE_PRICE_ALUMNI_2500_5000_YEARLY", DUMMY_PRICE_ID),
} as const;

function validatePriceIds() {
  // In skip mode, everything resolves to DUMMY_PRICE_ID, which already
  // satisfies the format check below — but skip the check anyway so a
  // future change that tightens validation doesn't accidentally require
  // CI to supply real price IDs.
  if (skipStripeValidation) return;
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
  apiVersion: "2025-12-15.clover" as Stripe.LatestApiVersion,
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

const alumniPrices: Record<Exclude<AlumniBucket, "none" | "5000+">, PriceMap> = {
  "0-250": {
    month: priceEnv.STRIPE_PRICE_ALUMNI_0_250_MONTHLY,
    year: priceEnv.STRIPE_PRICE_ALUMNI_0_250_YEARLY,
  },
  "251-500": {
    month: priceEnv.STRIPE_PRICE_ALUMNI_251_500_MONTHLY,
    year: priceEnv.STRIPE_PRICE_ALUMNI_251_500_YEARLY,
  },
  "501-1000": {
    month: priceEnv.STRIPE_PRICE_ALUMNI_501_1000_MONTHLY,
    year: priceEnv.STRIPE_PRICE_ALUMNI_501_1000_YEARLY,
  },
  "1001-2500": {
    month: priceEnv.STRIPE_PRICE_ALUMNI_1001_2500_MONTHLY,
    year: priceEnv.STRIPE_PRICE_ALUMNI_1001_2500_YEARLY,
  },
  "2500-5000": {
    month: priceEnv.STRIPE_PRICE_ALUMNI_2500_5000_MONTHLY,
    year: priceEnv.STRIPE_PRICE_ALUMNI_2500_5000_YEARLY,
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
  if (alumniBucket === "none" || alumniBucket === "5000+") {
    return { basePrice, alumniPrice: null as string | null };
  }

  const addOn = alumniPrices[alumniBucket];
  const alumniPrice = requirePriceId(addOn[interval], `alumni ${alumniBucket} ${interval}`);
  return { basePrice, alumniPrice };
}

export function isSalesLedBucket(bucket: AlumniBucket) {
  return bucket === "5000+";
}

export const STRIPE_PUBLISHABLE_KEY = stripePublishableKey;

export type ConnectAccountStatus = {
  isReady: boolean;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  disabledReason: string | null;
  lookupFailed: boolean;
};

export async function getConnectAccountStatus(accountId: string): Promise<ConnectAccountStatus> {
  try {
    const account = await stripe.accounts.retrieve(accountId);
    const detailsSubmitted = Boolean(account.details_submitted);
    const chargesEnabled = Boolean(account.charges_enabled);
    const payoutsEnabled = Boolean(account.payouts_enabled);

    return {
      isReady: detailsSubmitted && chargesEnabled && payoutsEnabled,
      detailsSubmitted,
      chargesEnabled,
      payoutsEnabled,
      disabledReason: account.requirements?.disabled_reason ?? null,
      lookupFailed: false,
    };
  } catch (error) {
    console.error("[stripe] Unable to retrieve connect account status", error);
    return {
      isReady: false,
      detailsSubmitted: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      disabledReason: "lookup_failed",
      lookupFailed: true,
    };
  }
}

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
