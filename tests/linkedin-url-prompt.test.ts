import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldShowLinkedInPrompt } from "@/lib/linkedin/prompt-logic";
import { linkedInProfileUrlSchema } from "@/lib/alumni/linkedin-url";

describe("LinkedInUrlPrompt", () => {
  describe("shouldShowLinkedInPrompt", () => {
    it("shows when connected, no URL, and not dismissed", () => {
      assert.equal(
        shouldShowLinkedInPrompt({ status: "connected" }, null, false),
        true
      );
    });

    it("hides when connected but URL already exists", () => {
      assert.equal(
        shouldShowLinkedInPrompt(
          { status: "connected" },
          "https://linkedin.com/in/johndoe",
          false
        ),
        false
      );
    });

    it("hides when no connection exists", () => {
      assert.equal(
        shouldShowLinkedInPrompt(null, null, false),
        false
      );
    });

    it("hides when connection status is not 'connected'", () => {
      assert.equal(
        shouldShowLinkedInPrompt({ status: "disconnected" }, null, false),
        false
      );
    });

    it("hides when dismissed via localStorage", () => {
      assert.equal(
        shouldShowLinkedInPrompt({ status: "connected" }, null, true),
        false
      );
    });

    it("shows when URL is empty string (no URL set)", () => {
      // Empty string is falsy — Boolean("") === false — so prompt shows
      assert.equal(
        shouldShowLinkedInPrompt({ status: "connected" }, "", false),
        true
      );
    });
  });

  describe("URL validation for save (required schema)", () => {
    it("accepts a valid LinkedIn URL", () => {
      const result = linkedInProfileUrlSchema.safeParse(
        "https://www.linkedin.com/in/johndoe"
      );
      assert.ok(result.success);
    });

    it("rejects an invalid URL", () => {
      const result = linkedInProfileUrlSchema.safeParse(
        "https://example.com/notlinkedin"
      );
      assert.ok(!result.success);
    });

    it("rejects an empty string", () => {
      const result = linkedInProfileUrlSchema.safeParse("");
      assert.ok(!result.success);
    });

    it("rejects a partial URL without linkedin domain", () => {
      const result = linkedInProfileUrlSchema.safeParse("johndoe");
      assert.ok(!result.success);
    });
  });
});
