/**
 * Sentry wrapper: normalize non-Error rejects (e.g. Supabase PostgREST) before capture.
 */

jest.mock("@sentry/react-native", () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  setUser: jest.fn(),
}));

describe("analytics/sentry", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("normalizeCaptureError uses PostgREST-style message", () => {
    const { normalizeCaptureError } = require("../../src/lib/analytics/sentry");
    const err = normalizeCaptureError({
      code: "PGRST301",
      details: null,
      hint: null,
      message: "JWT expired",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("JWT expired");
  });

  it("captureException forwards Error unchanged and merges extra context", () => {
    const Sentry = require("@sentry/react-native");
    const sentryModule = require("../../src/lib/analytics/sentry");

    sentryModule.init("https://example@sentry.io/1");
    sentryModule.setEnabled(true);

    const original = new Error("boom");
    sentryModule.captureException(original, { context: "test" });

    expect(Sentry.captureException).toHaveBeenCalledWith(original, {
      extra: { context: "test" },
    });
  });

  it("captureException converts plain object to Error and preserves code/details/hint", () => {
    const Sentry = require("@sentry/react-native");
    const sentryModule = require("../../src/lib/analytics/sentry");

    sentryModule.init("https://example@sentry.io/1");
    sentryModule.setEnabled(true);

    const payload = {
      code: "42P01",
      details: "relation missing",
      hint: "check schema",
      message: "relation \"foo\" does not exist",
    };
    sentryModule.captureException(payload, { context: "AuthContext.getSession" });

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const [passedError, opts] = Sentry.captureException.mock.calls[0];
    expect(passedError).toBeInstanceOf(Error);
    expect(passedError.message).toBe(payload.message);
    expect(opts).toEqual({
      extra: {
        code: "42P01",
        details: "relation missing",
        hint: "check schema",
        context: "AuthContext.getSession",
      },
    });
  });
});
