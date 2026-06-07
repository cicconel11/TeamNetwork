const REQUIRED_PROD_ENV = [
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  "EXPO_PUBLIC_WEB_URL",
  "EXPO_PUBLIC_TURNSTILE_SITE_KEY",
  "EXPO_PUBLIC_CAPTCHA_BASE_URL",
  "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY",
] as const;

const originalEnv = process.env;

function loadAppConfigWithEnv(env: NodeJS.ProcessEnv) {
  jest.resetModules();
  process.env = { ...originalEnv, ...env };
  return () => require("../app.config");
}

describe("mobile app config", () => {
  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  it("rejects production builds without the Stripe publishable key", () => {
    const env = Object.fromEntries(
      REQUIRED_PROD_ENV.map((key) => [key, `mock-${key.toLowerCase()}`]),
    );
    delete env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;

    expect(loadAppConfigWithEnv({ ...env, EAS_BUILD_PROFILE: "production" })).toThrow(
      /EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY/,
    );
  });

  it("loads production config when required public env vars are present", () => {
    const env = Object.fromEntries(
      REQUIRED_PROD_ENV.map((key) => [key, `mock-${key.toLowerCase()}`]),
    );

    expect(loadAppConfigWithEnv({ ...env, EAS_BUILD_PROFILE: "production" })).not.toThrow();
  });
});
