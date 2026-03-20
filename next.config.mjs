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

const linkedInEnv = [
  "LINKEDIN_CLIENT_ID",
  "LINKEDIN_CLIENT_SECRET",
  "LINKEDIN_TOKEN_ENCRYPTION_KEY",
];

const blackbaudEnv = [
  "BLACKBAUD_CLIENT_ID",
  "BLACKBAUD_CLIENT_SECRET",
  "BLACKBAUD_TOKEN_ENCRYPTION_KEY",
  "BLACKBAUD_SUBSCRIPTION_KEY",
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

  // Vercel production detection (used for stricter validation below)
  const isVercelProduction = process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production";

  // Require Connect webhook secret on Vercel production (donations fail silently without it)
  if (!process.env.STRIPE_WEBHOOK_SECRET_CONNECT && !skipStripe) {
    if (isVercelProduction) {
      throw new Error("Missing required environment variable: STRIPE_WEBHOOK_SECRET_CONNECT (required for donation webhooks)");
    }
    console.warn("⚠️  STRIPE_WEBHOOK_SECRET_CONNECT not set — Connect donation webhooks will return 503");
  }

  // Optional: warn if Google Calendar env vars are missing (feature will be disabled)
  const missingGoogleVars = googleCalendarEnv.filter((key) => !process.env[key] || process.env[key].trim() === "");
  if (missingGoogleVars.length > 0 && missingGoogleVars.length < googleCalendarEnv.length) {
    console.warn(`⚠️  Partial Google Calendar config: missing ${missingGoogleVars.join(", ")}. Google Calendar integration will not work.`);
  }

  // Optional: warn if LinkedIn env vars are partially configured
  const missingLinkedInVars = linkedInEnv.filter((key) => !process.env[key] || process.env[key].trim() === "");
  if (missingLinkedInVars.length > 0 && missingLinkedInVars.length < linkedInEnv.length) {
    console.warn(`⚠️  Partial LinkedIn config: missing ${missingLinkedInVars.join(", ")}. LinkedIn integration will not work.`);
  }

  // Optional: warn if Blackbaud env vars are partially configured
  const missingBlackbaudVars = blackbaudEnv.filter((key) => !process.env[key] || process.env[key].trim() === "");
  if (missingBlackbaudVars.length > 0 && missingBlackbaudVars.length < blackbaudEnv.length) {
    console.warn(`⚠️  Partial Blackbaud config: missing ${missingBlackbaudVars.join(", ")}. Blackbaud integration will not work.`);
  }

  // Optional: Proxycurl enrichment (enriches member profiles from LinkedIn)
  if (!process.env.PROXYCURL_API_KEY) {
    console.log("ℹ️  PROXYCURL_API_KEY not set — LinkedIn profile enrichment disabled");
  }

  // Require NEXT_PUBLIC_SITE_URL on Vercel production (OAuth redirects break without it)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  let parsedSiteUrl = null;
  if (siteUrl) {
    try {
      const parsed = new URL(siteUrl);
      parsedSiteUrl = {
        host: parsed.host,
        protocol: parsed.protocol,
      };
    } catch {
      parsedSiteUrl = null;
    }
  }
  if (
    isVercelProduction &&
    (!parsedSiteUrl || parsedSiteUrl.host !== "www.myteamnetwork.com" || parsedSiteUrl.protocol !== "https:")
  ) {
    console.warn(`⚠️  NEXT_PUBLIC_SITE_URL should use https://www.myteamnetwork.com in production, got: ${siteUrl || "(unset)"}. OAuth redirects may break.`);
  }

  // Require CRON_SECRET on Vercel production deploys, warn otherwise
  // (Local `next build` runs with NODE_ENV=production, so we key off Vercel env vars instead.)
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
  experimental: {
    serverComponentsExternalPackages: ["googleapis"],
  },
  images: {
    formats: ["image/avif", "image/webp"],
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
      {
        protocol: "https",
        hostname: "media.licdn.com",
      },
    ],
  },
  async redirects() {
    return [
      // Redirect old /schedules page URLs to /calendar.
      // Negative lookahead excludes "api" so /api/schedules/* API routes still work.
      // (?!api(?:/|$)) checks "not 'api' followed by / or end-of-string".
      // Using just (?!api$) fails because $ means end-of-full-string in the compiled
      // regex, so /api/schedules/... slips through (the text after "api" isn't EOS).
      {
        source: "/:orgSlug((?!api(?:/|$))[^/]+)/schedules",
        destination: "/:orgSlug/calendar",
        permanent: true,
      },
      {
        source: "/:orgSlug((?!api(?:/|$))[^/]+)/schedules/new",
        destination: "/:orgSlug/calendar/new",
        permanent: true,
      },
      {
        source: "/:orgSlug((?!api(?:/|$))[^/]+)/schedules/:path*",
        destination: "/:orgSlug/calendar/:path*",
        permanent: true,
      },
    ];
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
          ...(process.env.NODE_ENV === "production"
            ? [{
                key: "Strict-Transport-Security",
                value: "max-age=31536000; includeSubDomains",
              }]
            : []),
          {
            key: "Permissions-Policy",
            value: "camera=(self \"https://newassets.hcaptcha.com\" \"https://hcaptcha.com\"), microphone=(self \"https://newassets.hcaptcha.com\" \"https://hcaptcha.com\"), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://js.hcaptcha.com https://challenges.cloudflare.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' blob: data: https://lh3.googleusercontent.com https://avatars.githubusercontent.com https://rytsziwekhtjdqzzpdso.supabase.co https://media.licdn.com",
              "font-src 'self' https://fonts.gstatic.com",
              "frame-src https://hcaptcha.com https://newassets.hcaptcha.com https://challenges.cloudflare.com https://js.stripe.com https://connect.stripe.com https://*.stripe.com",
              "media-src 'self' blob: https://rytsziwekhtjdqzzpdso.supabase.co",
              "connect-src 'self' https://rytsziwekhtjdqzzpdso.supabase.co https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://connect.stripe.com",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
