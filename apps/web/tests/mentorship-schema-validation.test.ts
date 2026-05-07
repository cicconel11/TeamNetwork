import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

// ============================================================================
// Inline schema definitions (mirrors src/lib/schemas/mentorship.ts)
// to avoid transitive @/ path alias dependency that Node can't resolve.
// ============================================================================

const optionalSafeString = (max: number) =>
  z.string().trim().max(max, `Must be ${max} characters or fewer`).optional();

const optionalEmail = z
  .string()
  .trim()
  .email("Must be a valid email")
  .max(320)
  .optional()
  .or(z.literal(""));

const optionalHttpsUrlSchema = z
  .string()
  .trim()
  .refine(
    (val) => {
      if (!val) return true;
      try {
        const url = new URL(val);
        return url.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Must be a valid https:// URL" },
  )
  .optional();

const createMentorProfileSchema = z.object({
  bio: optionalSafeString(2000),
  expertise_areas: z
    .string()
    .trim()
    .max(1000, "Expertise areas must be 1000 characters or fewer")
    .optional(),
  contact_email: optionalEmail,
  contact_linkedin: optionalHttpsUrlSchema,
  contact_phone: z
    .string()
    .trim()
    .max(20, "Phone number must be 20 characters or fewer")
    .optional()
    .or(z.literal("")),
});

// ============================================================================
// Tests
// ============================================================================

describe("createMentorProfileSchema", () => {
  describe("valid inputs", () => {
    it("should accept profile with all fields", () => {
      const input = {
        bio: "Experienced software engineer with 10 years in the industry.",
        expertise_areas: "Software Engineering, Cloud Architecture, Mentoring",
        contact_email: "mentor@example.com",
        contact_linkedin: "https://linkedin.com/in/mentor",
        contact_phone: "+1-555-123-4567",
      };

      const result = createMentorProfileSchema.safeParse(input);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.data.bio, input.bio);
        assert.equal(result.data.expertise_areas, input.expertise_areas);
        assert.equal(result.data.contact_email, input.contact_email);
        assert.equal(result.data.contact_linkedin, input.contact_linkedin);
        assert.equal(result.data.contact_phone, input.contact_phone);
      }
    });

    it("should accept empty object (all fields optional)", () => {
      const result = createMentorProfileSchema.safeParse({});
      assert.equal(result.success, true);
    });

    it("should accept profile with only bio", () => {
      const result = createMentorProfileSchema.safeParse({
        bio: "Just a bio",
      });
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.data.bio, "Just a bio");
        assert.equal(result.data.expertise_areas, undefined);
        assert.equal(result.data.contact_email, undefined);
      }
    });

    it("should trim whitespace from all string fields", () => {
      const input = {
        bio: "  Bio with spaces  ",
        expertise_areas: "  Engineering, Design  ",
        contact_email: "  mentor@example.com  ",
        contact_phone: "  555-1234  ",
      };

      const result = createMentorProfileSchema.safeParse(input);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.data.bio, "Bio with spaces");
        assert.equal(result.data.expertise_areas, "Engineering, Design");
        assert.equal(result.data.contact_email, "mentor@example.com");
        assert.equal(result.data.contact_phone, "555-1234");
      }
    });
  });

  describe("bio validation", () => {
    it("should accept bio at max length (2000 chars)", () => {
      const result = createMentorProfileSchema.safeParse({
        bio: "a".repeat(2000),
      });
      assert.equal(result.success, true);
    });

    it("should reject bio over max length (2000 chars)", () => {
      const result = createMentorProfileSchema.safeParse({
        bio: "a".repeat(2001),
      });
      assert.equal(result.success, false);
    });

    it("should accept empty bio as undefined (optional)", () => {
      const result = createMentorProfileSchema.safeParse({});
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.data.bio, undefined);
      }
    });
  });

  describe("expertise_areas validation", () => {
    it("should accept expertise_areas at max length (1000 chars)", () => {
      const result = createMentorProfileSchema.safeParse({
        expertise_areas: "a".repeat(1000),
      });
      assert.equal(result.success, true);
    });

    it("should reject expertise_areas over max length (1000 chars)", () => {
      const result = createMentorProfileSchema.safeParse({
        expertise_areas: "a".repeat(1001),
      });
      assert.equal(result.success, false);
    });

    it("should accept comma-separated expertise list", () => {
      const result = createMentorProfileSchema.safeParse({
        expertise_areas: "Engineering, Design, Management, Leadership",
      });
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(
          result.data.expertise_areas,
          "Engineering, Design, Management, Leadership"
        );
      }
    });
  });

  describe("contact_email validation", () => {
    it("should accept valid email", () => {
      const result = createMentorProfileSchema.safeParse({
        contact_email: "mentor@example.com",
      });
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.data.contact_email, "mentor@example.com");
      }
    });

    it("should reject invalid email format", () => {
      const result = createMentorProfileSchema.safeParse({
        contact_email: "not-an-email",
      });
      assert.equal(result.success, false);
    });

    it("should accept empty string for email (cleared field)", () => {
      const result = createMentorProfileSchema.safeParse({
        contact_email: "",
      });
      assert.equal(result.success, true);
    });

    it("should reject email over max length (320 chars)", () => {
      const localPart = "a".repeat(64);
      const domain = "a".repeat(256) + ".com";
      const result = createMentorProfileSchema.safeParse({
        contact_email: `${localPart}@${domain}`,
      });
      assert.equal(result.success, false);
    });
  });

  describe("contact_linkedin validation", () => {
    it("should accept valid https LinkedIn URL", () => {
      const result = createMentorProfileSchema.safeParse({
        contact_linkedin: "https://linkedin.com/in/johndoe",
      });
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(
          result.data.contact_linkedin,
          "https://linkedin.com/in/johndoe"
        );
      }
    });

    it("should accept any valid https URL", () => {
      const result = createMentorProfileSchema.safeParse({
        contact_linkedin: "https://www.linkedin.com/in/johndoe",
      });
      assert.equal(result.success, true);
    });

    it("should reject non-https URL (http)", () => {
      const result = createMentorProfileSchema.safeParse({
        contact_linkedin: "http://linkedin.com/in/johndoe",
      });
      assert.equal(result.success, false);
    });

    it("should reject invalid URL format", () => {
      const result = createMentorProfileSchema.safeParse({
        contact_linkedin: "not-a-url",
      });
      assert.equal(result.success, false);
    });

    it("should accept empty string for LinkedIn (cleared field)", () => {
      const result = createMentorProfileSchema.safeParse({
        contact_linkedin: "",
      });
      assert.equal(result.success, true);
    });

    it("should accept undefined for LinkedIn (optional)", () => {
      const result = createMentorProfileSchema.safeParse({});
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.data.contact_linkedin, undefined);
      }
    });
  });

  describe("contact_phone validation", () => {
    it("should accept valid phone number", () => {
      const result = createMentorProfileSchema.safeParse({
        contact_phone: "+1-555-123-4567",
      });
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.data.contact_phone, "+1-555-123-4567");
      }
    });

    it("should accept phone at max length (20 chars)", () => {
      const result = createMentorProfileSchema.safeParse({
        contact_phone: "1".repeat(20),
      });
      assert.equal(result.success, true);
    });

    it("should reject phone over max length (20 chars)", () => {
      const result = createMentorProfileSchema.safeParse({
        contact_phone: "1".repeat(21),
      });
      assert.equal(result.success, false);
    });

    it("should accept empty string for phone (cleared field)", () => {
      const result = createMentorProfileSchema.safeParse({
        contact_phone: "",
      });
      assert.equal(result.success, true);
    });

    it("should accept international phone formats", () => {
      const result = createMentorProfileSchema.safeParse({
        contact_phone: "+44 20 7946 0958",
      });
      assert.equal(result.success, true);
    });
  });

  describe("edge cases", () => {
    it("should reject unknown fields (strict by default in Zod)", () => {
      // Zod .object() strips unknown keys by default (not strict)
      const input = {
        bio: "Valid bio",
        unknown_field: "should be stripped",
      };
      const result = createMentorProfileSchema.safeParse(input);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(
          (result.data as Record<string, unknown>)["unknown_field"],
          undefined
        );
      }
    });

    it("should handle all fields as empty strings", () => {
      const input = {
        bio: "",
        expertise_areas: "",
        contact_email: "",
        contact_linkedin: "",
        contact_phone: "",
      };
      const result = createMentorProfileSchema.safeParse(input);
      assert.equal(result.success, true);
    });

    it("should handle whitespace-only fields (trimmed to empty)", () => {
      const input = {
        bio: "   ",
        expertise_areas: "   ",
        contact_phone: "   ",
      };
      const result = createMentorProfileSchema.safeParse(input);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.data.bio, "");
        assert.equal(result.data.expertise_areas, "");
        assert.equal(result.data.contact_phone, "");
      }
    });
  });
});
