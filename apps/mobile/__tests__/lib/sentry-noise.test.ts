import {
  shouldIgnoreSentryError,
  shouldIgnoreSentryEvent,
} from "../../src/lib/analytics/sentry-noise";

describe("sentry-noise", () => {
  describe("shouldIgnoreSentryError", () => {
    it("returns true for NetworkUnreachableError by constructor name", () => {
      class NetworkUnreachableError extends Error {
        constructor(message?: string) {
          super(message ?? "Network unreachable");
          this.name = "NetworkUnreachableError";
        }
      }
      expect(
        shouldIgnoreSentryError(new NetworkUnreachableError())
      ).toBe(true);
    });

    it("returns true when message matches unreachable pattern", () => {
      expect(
        shouldIgnoreSentryError(new Error("Network unreachable"))
      ).toBe(true);
      expect(
        shouldIgnoreSentryError(new Error("Network is unreachable"))
      ).toBe(true);
    });

    it("returns false for unrelated errors", () => {
      expect(shouldIgnoreSentryError(new Error("Session expired"))).toBe(false);
      expect(shouldIgnoreSentryError("not an error")).toBe(false);
    });
  });

  describe("shouldIgnoreSentryEvent", () => {
    it("returns true when exception type is NetworkUnreachableError", () => {
      expect(
        shouldIgnoreSentryEvent({
          exception: {
            values: [{ type: "NetworkUnreachableError", value: "Network unreachable" }],
          },
        })
      ).toBe(true);
    });

    it("returns true when exception value matches unreachable pattern", () => {
      expect(
        shouldIgnoreSentryEvent({
          exception: { values: [{ type: "Error", value: "Network unreachable" }] },
        })
      ).toBe(true);
    });

    it("returns false when no matching exception", () => {
      expect(
        shouldIgnoreSentryEvent({
          exception: { values: [{ type: "Error", value: "Something else" }] },
        })
      ).toBe(false);
      expect(shouldIgnoreSentryEvent({})).toBe(false);
    });
  });
});
