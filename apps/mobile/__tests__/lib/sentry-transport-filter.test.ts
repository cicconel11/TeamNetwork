import { shouldDropBenignClientTransportEvent } from "@/lib/analytics/sentry-transport-filter";

describe("shouldDropBenignClientTransportEvent", () => {
  it("drops NetworkUnreachableError from fetchWithAuth", () => {
    expect(
      shouldDropBenignClientTransportEvent({
        exception: {
          values: [{ type: "NetworkUnreachableError", value: "Network unreachable" }],
        },
      })
    ).toBe(true);
  });

  it("drops React Native TypeError: Network request failed", () => {
    expect(
      shouldDropBenignClientTransportEvent({
        exception: {
          values: [{ type: "TypeError", value: "Network request failed" }],
        },
      })
    ).toBe(true);
  });

  it("does not drop unrelated TypeErrors", () => {
    expect(
      shouldDropBenignClientTransportEvent({
        exception: {
          values: [{ type: "TypeError", value: "Cannot read property 'x' of undefined" }],
        },
      })
    ).toBe(false);
  });

  it("drops iOS offline Error messages", () => {
    expect(
      shouldDropBenignClientTransportEvent({
        exception: {
          values: [
            {
              type: "Error",
              value: "The Internet connection appears to be offline.",
            },
          ],
        },
      })
    ).toBe(true);
  });
});
