/**
 * Analytics policy tests — minor-aware tracking levels (Apple 5.1.4).
 */

import {
  canTrackBehavioralEvent,
  getAgeBracketFromUserMetadata,
  normalizeAgeBracket,
  resolveTrackingLevel,
} from "../src/lib/analytics/policy";

describe("normalizeAgeBracket", () => {
  it("accepts valid brackets", () => {
    expect(normalizeAgeBracket("under_13")).toBe("under_13");
    expect(normalizeAgeBracket("13_17")).toBe("13_17");
    expect(normalizeAgeBracket("18_plus")).toBe("18_plus");
  });

  it("rejects unknown values", () => {
    expect(normalizeAgeBracket("adult")).toBeNull();
    expect(normalizeAgeBracket(undefined)).toBeNull();
    expect(normalizeAgeBracket(null)).toBeNull();
    expect(normalizeAgeBracket(42)).toBeNull();
  });
});

describe("getAgeBracketFromUserMetadata", () => {
  it("reads age_bracket from user_metadata", () => {
    expect(getAgeBracketFromUserMetadata({ age_bracket: "13_17" })).toBe("13_17");
  });

  it("returns null for missing/empty metadata", () => {
    expect(getAgeBracketFromUserMetadata(null)).toBeNull();
    expect(getAgeBracketFromUserMetadata(undefined)).toBeNull();
    expect(getAgeBracketFromUserMetadata({})).toBeNull();
  });
});

describe("resolveTrackingLevel", () => {
  it("maps brackets to levels", () => {
    expect(resolveTrackingLevel("under_13")).toBe("none");
    expect(resolveTrackingLevel("13_17")).toBe("page_view_only");
    expect(resolveTrackingLevel("18_plus")).toBe("full");
  });

  it("treats unknown bracket conservatively as page_view_only", () => {
    expect(resolveTrackingLevel(null)).toBe("page_view_only");
    expect(resolveTrackingLevel(undefined)).toBe("page_view_only");
  });
});

describe("canTrackBehavioralEvent", () => {
  it("only allows behavioral events at full", () => {
    expect(canTrackBehavioralEvent("full")).toBe(true);
    expect(canTrackBehavioralEvent("page_view_only")).toBe(false);
    expect(canTrackBehavioralEvent("none")).toBe(false);
  });
});
