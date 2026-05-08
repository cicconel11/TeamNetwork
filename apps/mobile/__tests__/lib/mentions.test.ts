import {
  buildMentionMarker,
  extractMentionedUserIds,
  parseMentionMarkers,
  renderMentionPlainText,
} from "@/lib/mentions";

describe("mentions", () => {
  const userA = "11111111-1111-1111-1111-111111111111";
  const userB = "22222222-2222-2222-2222-222222222222";

  describe("extractMentionedUserIds", () => {
    it("returns ids in stable order with duplicates removed", () => {
      const body = `hey [@${userA}|Alice] and [@${userB}|Bob], also [@${userA}|Alice] again`;
      expect(extractMentionedUserIds(body)).toEqual([userA, userB]);
    });

    it("returns empty array when no markers present", () => {
      expect(extractMentionedUserIds("just prose with @nonsense")).toEqual([]);
    });

    it("ignores invalid uuid patterns", () => {
      expect(extractMentionedUserIds("[@not-a-uuid|Name]")).toEqual([]);
    });

    it("normalizes case to lowercase", () => {
      const upper = userA.toUpperCase();
      expect(extractMentionedUserIds(`[@${upper}|Alice]`)).toEqual([userA]);
    });
  });

  describe("parseMentionMarkers", () => {
    it("preserves order and display name per occurrence", () => {
      const body = `[@${userA}|Alice] [@${userB}|Bob]`;
      expect(parseMentionMarkers(body)).toEqual([
        { userId: userA, displayName: "Alice" },
        { userId: userB, displayName: "Bob" },
      ]);
    });
  });

  describe("renderMentionPlainText", () => {
    it("substitutes markers with @DisplayName", () => {
      const body = `hi [@${userA}|Alice] and [@${userB}|Bob]`;
      expect(renderMentionPlainText(body)).toBe("hi @Alice and @Bob");
    });

    it("leaves prose with stray @ untouched", () => {
      expect(renderMentionPlainText("email me @ alice@example.com")).toBe(
        "email me @ alice@example.com",
      );
    });
  });

  describe("buildMentionMarker", () => {
    it("strips brackets from display names so the parser stays unambiguous", () => {
      expect(buildMentionMarker(userA, "Alice [Admin]")).toBe(
        `[@${userA}|Alice Admin]`,
      );
    });
  });

  describe("round-trip", () => {
    it("buildMentionMarker → extractMentionedUserIds yields the original id", () => {
      const marker = buildMentionMarker(userA, "Alice");
      expect(extractMentionedUserIds(marker)).toEqual([userA]);
    });
  });
});
