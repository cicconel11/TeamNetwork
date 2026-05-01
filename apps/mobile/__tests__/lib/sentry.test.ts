/**
 * Sentry wrapper: normalize PostgREST-shaped plain objects before captureException.
 */

const sentryCaptureMock = jest.fn();

jest.mock("@sentry/react-native", () => ({
  init: jest.fn(),
  captureException: (...args: unknown[]) => sentryCaptureMock(...args),
  captureMessage: jest.fn(),
  setUser: jest.fn(),
}));

jest.unmock("@/lib/analytics/sentry");

describe("analytics/sentry captureException", () => {
  beforeEach(() => {
    jest.resetModules();
    sentryCaptureMock.mockClear();
    const mod = require("@/lib/analytics/sentry") as typeof import("@/lib/analytics/sentry");
    mod.init("https://key@o123.ingest.sentry.io/1");
    mod.setEnabled(true);
  });

  it("wraps Supabase PostgrestError-shaped objects in Error with extra fields", () => {
    const mod = require("@/lib/analytics/sentry") as typeof import("@/lib/analytics/sentry");
    const postgrestLike = {
      code: "PGRST301",
      message: "JWT expired",
      details: "session ended",
      hint: "renew token",
    };

    mod.captureException(postgrestLike, { context: "test" });

    expect(sentryCaptureMock).toHaveBeenCalledTimes(1);
    const [err, opts] = sentryCaptureMock.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("JWT expired");
    expect(opts).toEqual({
      extra: {
        postgrest_code: "PGRST301",
        postgrest_details: "session ended",
        postgrest_hint: "renew token",
        context: "test",
      },
    });
  });

  it("passes real Error instances through unchanged", () => {
    const mod = require("@/lib/analytics/sentry") as typeof import("@/lib/analytics/sentry");
    const err = new Error("boom");
    mod.captureException(err, { screen: "Login" });

    expect(sentryCaptureMock).toHaveBeenCalledWith(err, {
      extra: { screen: "Login" },
    });
  });
});

describe("toSentryError", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("stringifies non-PostgREST objects for the Error message", () => {
    const { toSentryError } = require("@/lib/analytics/sentry") as typeof import("@/lib/analytics/sentry");
    const { error, extraFromValue } = toSentryError({ foo: 1 });
    expect(error.message).toBe(JSON.stringify({ foo: 1 }));
    expect(extraFromValue).toBeUndefined();
  });
});
