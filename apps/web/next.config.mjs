// Only require Supabase in development, Stripe is optional for local dev
const supabaseEnv = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];

const stripeEnv = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const priceEnvKeys = [
  "STRIPE_PRICE_BASE_MONTHLY",
  "STRIPE_PRICE_BASE_YEARLY",
  "STRIPE_PRICE_ALUMNI_0_250_MONTHLY",
  "STRIPE_PRICE_ALUMNI_0_250_YEARLY",
  "STRIPE_PRICE_ALUMNI_251_500_MONTHLY",
  "STRIPE_PRICE_ALUMNI_251_500_YEARLY",
  "STRIPE_PRICE_ALUMNI_501_1000_MONTHLY",
  "STRIPE_PRICE_ALUMNI_501_1000_YEARLY",
  "STRIPE_PRICE_ALUMNI_1001_2500_MONTHLY",
  "STRIPE_PRICE_ALUMNI_1001_2500_YEARLY",
  "STRIPE_PRICE_ALUMNI_2500_5000_MONTHLY",
  "STRIPE_PRICE_ALUMNI_2500_5000_YEARLY",
];

function assertEnv(name, required = true) {
  const value = process.env[name];
  if (required && (!value || value.trim() === "")) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value || "";
}

function validateBuildEnv() {
  const isDev = process.env.NODE_ENV !== "production";
  const skipStripe = process.env.SKIP_STRIPE_VALIDATION === "true" || (isDev && !process.env.STRIPE_SECRET_KEY);
  
  // Always require Supabase
  supabaseEnv.forEach((key) => assertEnv(key, true));
  
  if (skipStripe) {
    console.log("⚠️  Skipping Stripe validation (dev mode without Stripe keys)");
  } else {
    // Require Stripe in production
    stripeEnv.forEach((key) => assertEnv(key, true));
    
    priceEnvKeys.forEach((key) => {
      const value = assertEnv(key, true);
      if (!value.startsWith("price_") || value.startsWith("cs_") || value.startsWith("prod_")) {
        throw new Error(`Invalid Stripe price id for ${key}: ${value}`);
      }
    });
  }
}

validateBuildEnv();

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "rytsziwekhtjdqzzpdso.supabase.co",
      },
    ],
  },
};

export default nextConfig;
