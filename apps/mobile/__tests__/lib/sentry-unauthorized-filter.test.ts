import { isBenignWebApiUnauthorizedSentryEvent } from "@/lib/analytics/sentry";

describe("isBenignWebApiUnauthorizedSentryEvent", () => {
  it("detects Next.js API Unauthorized JSON body surfaced as Error", () => {
    expect(
      isBenignWebApiUnauthorizedSentryEvent({
        exception: { values: [{ type: "Error", value: "Unauthorized" }] },
      })
    ).toBe(true);
  });

  it("returns false without matching exceptions", () => {
    expect(isBenignWebApiUnauthorizedSentryEvent({})).toBe(false);
    expect(
      isBenignWebApiUnauthorizedSentryEvent({
        exception: { values: [{ value: "Forbidden" }] },
      })
    ).toBe(false);
  });
});
