/**
 * `isAppReviewEmail` reads EXPO_PUBLIC_APP_REVIEW_EMAIL at module load, so each
 * case resets modules and re-imports with the env configured for that case.
 */

const ORIGINAL = process.env.EXPO_PUBLIC_APP_REVIEW_EMAIL;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.EXPO_PUBLIC_APP_REVIEW_EMAIL;
  } else {
    process.env.EXPO_PUBLIC_APP_REVIEW_EMAIL = ORIGINAL;
  }
  jest.resetModules();
});

function loadWithEmail(email: string | undefined) {
  jest.resetModules();
  if (email === undefined) {
    delete process.env.EXPO_PUBLIC_APP_REVIEW_EMAIL;
  } else {
    process.env.EXPO_PUBLIC_APP_REVIEW_EMAIL = email;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@/lib/app-review") as typeof import("@/lib/app-review");
}

describe("isAppReviewEmail", () => {
  it("matches the configured reviewer email (case-insensitive, trimmed)", () => {
    const { isAppReviewEmail } = loadWithEmail("test-reviewer@myteamnetwork.com");
    expect(isAppReviewEmail("test-reviewer@myteamnetwork.com")).toBe(true);
    expect(isAppReviewEmail("  TEST-Reviewer@MyTeamNetwork.com  ")).toBe(true);
  });

  it("returns false for any other email", () => {
    const { isAppReviewEmail } = loadWithEmail("test-reviewer@myteamnetwork.com");
    expect(isAppReviewEmail("someone-else@example.com")).toBe(false);
    expect(isAppReviewEmail(null)).toBe(false);
    expect(isAppReviewEmail(undefined)).toBe(false);
  });

  it("is default-closed when the env var is unset", () => {
    const { isAppReviewEmail } = loadWithEmail(undefined);
    expect(isAppReviewEmail("test-reviewer@myteamnetwork.com")).toBe(false);
  });

  it("exposes a stable sentinel captcha token", () => {
    const { APP_REVIEW_CAPTCHA_TOKEN } = loadWithEmail("test-reviewer@myteamnetwork.com");
    expect(APP_REVIEW_CAPTCHA_TOKEN).toBe("app-review-bypass");
  });
});
