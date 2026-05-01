import {
  isBenignNetworkFailure,
  shouldDropBenignNetworkNoise,
} from "../src/lib/analytics/sentry-noise";

describe("sentry-noise", () => {
  describe("shouldDropBenignNetworkNoise", () => {
    it("drops NetworkUnreachableError from exception values", () => {
      const event = {
        exception: {
          values: [{ type: "NetworkUnreachableError", value: "Network unreachable" }],
        },
      };
      expect(shouldDropBenignNetworkNoise(event)).toBe(true);
    });

    it("drops when originalException is benign", () => {
      expect(
        shouldDropBenignNetworkNoise(
          {},
          { originalException: new TypeError("Failed to fetch") }
        )
      ).toBe(true);
    });

    it("keeps unrelated errors", () => {
      const event = {
        exception: {
          values: [{ type: "Error", value: "Invalid API key" }],
        },
      };
      expect(shouldDropBenignNetworkNoise(event)).toBe(false);
    });
  });

  describe("isBenignNetworkFailure", () => {
    it("returns true for NetworkUnreachableError", () => {
      const err = new Error("Network unreachable");
      err.name = "NetworkUnreachableError";
      expect(isBenignNetworkFailure(err)).toBe(true);
    });

    it("returns false for other errors", () => {
      expect(isBenignNetworkFailure(new Error("Something broke"))).toBe(false);
    });
  });
});
