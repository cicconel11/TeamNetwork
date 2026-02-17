import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

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

const enterprisePriceEnvKeys = [
  "STRIPE_PRICE_ENTERPRISE_ALUMNI_BUCKET_MONTHLY",
  "STRIPE_PRICE_ENTERPRISE_ALUMNI_BUCKET_YEARLY",
  "STRIPE_PRICE_ENTERPRISE_SUB_ORG_MONTHLY",
  "STRIPE_PRICE_ENTERPRISE_SUB_ORG_YEARLY",
];

const googleCalendarEnv = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_TOKEN_ENCRYPTION_KEY",
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

    enterprisePriceEnvKeys.forEach((key) => {
      const value = assertEnv(key, true);
      if (!value.startsWith("price_") || value.startsWith("cs_") || value.startsWith("prod_")) {
        throw new Error(`Invalid Stripe price id for ${key}: ${value}`);
      }
    });
  }

  // Warn if Connect webhook secret is missing (donation events won't be processed)
  if (!process.env.STRIPE_WEBHOOK_SECRET_CONNECT && !skipStripe) {
    console.warn("⚠️  STRIPE_WEBHOOK_SECRET_CONNECT not set — Connect donation events will not be processed");
  }

  // Optional: warn if Google Calendar env vars are missing (feature will be disabled)
  const missingGoogleVars = googleCalendarEnv.filter((key) => !process.env[key] || process.env[key].trim() === "");
  if (missingGoogleVars.length > 0 && missingGoogleVars.length < googleCalendarEnv.length) {
    console.warn(`⚠️  Partial Google Calendar config: missing ${missingGoogleVars.join(", ")}. Google Calendar integration will not work.`);
  }

  // Require CRON_SECRET on Vercel production deploys, warn otherwise
  // (Local `next build` runs with NODE_ENV=production, so we key off Vercel env vars instead.)
  const isVercelProduction = process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production";
  const cronSecret = process.env.CRON_SECRET;
  if (isVercelProduction && (!cronSecret || cronSecret.trim() === "")) {
    throw new Error("Missing required environment variable: CRON_SECRET (required on Vercel production)");
  }
  if (!isDev && !cronSecret) {
    console.warn("⚠️  CRON_SECRET not set — cron job authentication will not work");
  }
}

validateBuildEnv();

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Temporarily ignore ESLint during builds to avoid circular reference issue
    ignoreDuringBuilds: true,
  },
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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://js.hcaptcha.com https://challenges.cloudflare.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' blob: data: https://lh3.googleusercontent.com https://avatars.githubusercontent.com https://rytsziwekhtjdqzzpdso.supabase.co",
              "font-src 'self' https://fonts.gstatic.com",
              "frame-src https://hcaptcha.com https://newassets.hcaptcha.com https://challenges.cloudflare.com https://js.stripe.com https://connect.stripe.com https://*.stripe.com",
              "connect-src 'self' https://rytsziwekhtjdqzzpdso.supabase.co https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://connect.stripe.com",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
