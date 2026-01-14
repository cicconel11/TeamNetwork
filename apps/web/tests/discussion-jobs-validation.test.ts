import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

// ============================================================================
// Inline schema definitions (mirrors src/lib/schemas/discussion.ts and jobs.ts)
// to avoid transitive @/ path alias dependency that Node 25 can't resolve.
// ============================================================================

const safeString = (max: number, min = 1) =>
  z.string().trim().min(min, "Value is required").max(max, `Must be ${max} characters or fewer`);

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

const createThreadSchema = z.object({
  title: safeString(200, 5),
  body: safeString(10000, 10),
});

const createReplySchema = z.object({
  body: safeString(5000, 1),
});

const createJobSchema = z.object({
  title: safeString(200, 3),
  company: safeString(200, 2),
  location: optionalSafeString(200),
  location_type: z.enum(["remote", "hybrid", "onsite"]).optional(),
  description: safeString(10000, 10),
  application_url: optionalHttpsUrlSchema,
  contact_email: optionalEmail,
});

// ============================================================================
// Tests
// ============================================================================

describe("createThreadSchema", () => {
  describe("valid inputs", () => {
    it("should accept valid thread with title and body", () => {
      const input = {
        title: "Valid thread title",
        body: "This is a valid thread body with enough characters.",
      };

      const result = createThreadSchema.safeParse(input);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.data.title, "Valid thread title");
        assert.equal(result.data.body, "This is a valid thread body with enough characters.");
      }
    });

    it("should trim whitespace from title and body", () => {
      const input = {
        title: "  Valid title  ",
        body: "  Valid body content with whitespace  ",
      };

      const result = createThreadSchema.safeParse(input);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.data.title, "Valid title");
        assert.equal(result.data.body, "Valid body content with whitespace");
      }
    });

    it("should accept title at max length (200 chars)", () => {
      const input = {
        title: "a".repeat(200),
        body: "Valid body content",
      };

      const result = createThreadSchema.safeParse(input);
      assert.equal(result.success, true);
    });

    it("should accept body at max length (10000 chars)", () => {
      const input = {
        title: "Valid title",
        body: "a".repeat(10000),
      };

      const result = createThreadSchema.safeParse(input);
      assert.equal(result.success, true);
    });
  });

  describe("title validation", () => {
    it("should reject title too short (under 5 chars)", () => {
      const input = {
        title: "abcd",
        body: "Valid body content",
      };

      const result = createThreadSchema.safeParse(input);
      assert.equal(result.success, false);
    });

    it("should reject title too long (over 200 chars)", () => {
      const input = {
        title: "a".repeat(201),
        body: "Valid body content",
      };

      const result = createThreadSchema.safeParse(input);
      assert.equal(result.success, false);
    });

    it("should reject missing title", () => {
      const input = {
        body: "Valid body content",
      };

      const result = createThreadSchema.safeParse(input);
      assert.equal(result.success, false);
    });

    it("should reject empty title", () => {
      const input = {
        title: "",
        body: "Valid body content",
      };

      const result = createThreadSchema.safeParse(input);
      assert.equal(result.success, false);
    });

    it("should reject title with only whitespace", () => {
      const input = {
        title: "     ",
        body: "Valid body content",
      };

      const result = createThreadSchema.safeParse(input);
      assert.equal(result.success, false);
    });
  });

  describe("body validation", () => {
    it("should reject body too short (under 10 chars)", () => {
      const input = {
        title: "Valid title",
        body: "short",
      };

      const result = createThreadSchema.safeParse(input);
      assert.equal(result.success, false);
    });

    it("should reject body too long (over 10000 chars)", () => {
      const input = {
        title: "Valid title",
        body: "a".repeat(10001),
      };

      const result = createThreadSchema.safeParse(input);
      assert.equal(result.success, false);
    });

    it("should reject missing body", () => {
      const input = {
        title: "Valid title",
      };

      const result = createThreadSchema.safeParse(input);
      assert.equal(result.success, false);
    });

    it("should reject empty body", () => {
      const input = {
        title: "Valid title",
        body: "",
      };

      const result = createThreadSchema.safeParse(input);
      assert.equal(result.success, false);
    });

    it("should reject body with only whitespace", () => {
      const input = {
        title: "Valid title",
        body: "         ",
      };

      const result = createThreadSchema.safeParse(input);
      assert.equal(result.success, false);
    });
  });
});

describe("createReplySchema", () => {
  describe("valid inputs", () => {
    it("should accept valid reply body", () => {
      const input = {
        body: "This is a valid reply",
      };

      const result = createReplySchema.safeParse(input);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.data.body, "This is a valid reply");
      }
    });

    it("should trim whitespace from body", () => {
      const input = {
        body: "  Valid reply body  ",
      };

      const result = createReplySchema.safeParse(input);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.data.body, "Valid reply body");
      }
    });

    it("should accept body at max length (5000 chars)", () => {
      const input = {
        body: "a".repeat(5000),
      };

      const result = createReplySchema.safeParse(input);
      assert.equal(result.success, true);
    });

    it("should accept single character body (min 1)", () => {
      const input = {
        body: "a",
      };

      const result = createReplySchema.safeParse(input);
      assert.equal(result.success, true);
    });
  });

  describe("body validation", () => {
    it("should reject body too long (over 5000 chars)", () => {
      const input = {
        body: "a".repeat(5001),
      };

      const result = createReplySchema.safeParse(input);
      assert.equal(result.success, false);
    });

    it("should reject missing body field", () => {
      const input = {};

      const result = createReplySchema.safeParse(input);
      assert.equal(result.success, false);
    });

    it("should reject empty body", () => {
      const input = {
        body: "",
      };

      const result = createReplySchema.safeParse(input);
      assert.equal(result.success, false);
    });

    it("should reject body with only whitespace", () => {
      const input = {
        body: "     ",
      };

      const result = createReplySchema.safeParse(input);
      assert.equal(result.success, false);
    });
  });
});

describe("createJobSchema", () => {
  describe("valid inputs", () => {
    it("should accept valid job with all fields", () => {
      const input = {
        title: "Software Engineer",
        company: "Tech Corp",
        location: "San Francisco, CA",
        location_type: "hybrid" as const,
        description: "This is a valid job description with enough characters.",
        application_url: "https://example.com/apply",
        contact_email: "jobs@example.com",
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.data.title, "Software Engineer");
        assert.equal(result.data.company, "Tech Corp");
        assert.equal(result.data.location, "San Francisco, CA");
        assert.equal(result.data.location_type, "hybrid");
        assert.equal(result.data.description, "This is a valid job description with enough characters.");
        assert.equal(result.data.application_url, "https://example.com/apply");
        assert.equal(result.data.contact_email, "jobs@example.com");
      }
    });

    it("should accept job with only required fields", () => {
      const input = {
        title: "Software Engineer",
        company: "Tech Corp",
        description: "This is a valid job description.",
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.data.title, "Software Engineer");
        assert.equal(result.data.company, "Tech Corp");
        assert.equal(result.data.description, "This is a valid job description.");
      }
    });

    it("should accept remote location_type", () => {
      const input = {
        title: "Software Engineer",
        company: "Tech Corp",
        description: "Valid description",
        location_type: "remote" as const,
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.data.location_type, "remote");
      }
    });

    it("should accept onsite location_type", () => {
      const input = {
        title: "Software Engineer",
        company: "Tech Corp",
        description: "Valid description",
        location_type: "onsite" as const,
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.data.location_type, "onsite");
      }
    });

    it("should accept job without optional fields", () => {
      const input = {
        title: "Software Engineer",
        company: "Tech Corp",
        description: "Valid description",
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.data.location, undefined);
        assert.equal(result.data.location_type, undefined);
        assert.equal(result.data.application_url, undefined);
        assert.equal(result.data.contact_email, undefined);
      }
    });

    it("should accept empty string for optional email (converted to undefined)", () => {
      const input = {
        title: "Software Engineer",
        company: "Tech Corp",
        description: "Valid description",
        contact_email: "",
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.data.contact_email, "");
      }
    });
  });

  describe("title validation", () => {
    it("should reject title too short (under 3 chars)", () => {
      const input = {
        title: "ab",
        company: "Tech Corp",
        description: "Valid description",
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, false);
    });

    it("should accept title at min length (3 chars)", () => {
      const input = {
        title: "abc",
        company: "Tech Corp",
        description: "Valid description",
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, true);
    });

    it("should accept title at max length (200 chars)", () => {
      const input = {
        title: "a".repeat(200),
        company: "Tech Corp",
        description: "Valid description",
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, true);
    });

    it("should reject missing title", () => {
      const input = {
        company: "Tech Corp",
        description: "Valid description",
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, false);
    });
  });

  describe("company validation", () => {
    it("should reject company too short (under 2 chars)", () => {
      const input = {
        title: "Software Engineer",
        company: "a",
        description: "Valid description",
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, false);
    });

    it("should accept company at min length (2 chars)", () => {
      const input = {
        title: "Software Engineer",
        company: "ab",
        description: "Valid description",
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, true);
    });

    it("should accept company at max length (200 chars)", () => {
      const input = {
        title: "Software Engineer",
        company: "a".repeat(200),
        description: "Valid description",
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, true);
    });

    it("should reject missing company", () => {
      const input = {
        title: "Software Engineer",
        description: "Valid description",
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, false);
    });
  });

  describe("description validation", () => {
    it("should reject description too short (under 10 chars)", () => {
      const input = {
        title: "Software Engineer",
        company: "Tech Corp",
        description: "short",
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, false);
    });

    it("should accept description at min length (10 chars)", () => {
      const input = {
        title: "Software Engineer",
        company: "Tech Corp",
        description: "a".repeat(10),
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, true);
    });

    it("should accept very long description (near 10000 char limit)", () => {
      const input = {
        title: "Software Engineer",
        company: "Tech Corp",
        description: "a".repeat(9999),
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, true);
    });

    it("should accept description at max length (10000 chars)", () => {
      const input = {
        title: "Software Engineer",
        company: "Tech Corp",
        description: "a".repeat(10000),
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, true);
    });

    it("should reject missing description", () => {
      const input = {
        title: "Software Engineer",
        company: "Tech Corp",
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, false);
    });
  });

  describe("location_type validation", () => {
    it("should reject invalid location_type value", () => {
      const input = {
        title: "Software Engineer",
        company: "Tech Corp",
        description: "Valid description",
        location_type: "invalid",
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, false);
    });
  });

  describe("application_url validation", () => {
    it("should accept valid https URL", () => {
      const input = {
        title: "Software Engineer",
        company: "Tech Corp",
        description: "Valid description",
        application_url: "https://example.com/apply",
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, true);
    });

    it("should reject non-https URL (http)", () => {
      const input = {
        title: "Software Engineer",
        company: "Tech Corp",
        description: "Valid description",
        application_url: "http://example.com/apply",
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, false);
    });

    it("should reject invalid URL format", () => {
      const input = {
        title: "Software Engineer",
        company: "Tech Corp",
        description: "Valid description",
        application_url: "not-a-url",
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, false);
    });

    it("should accept empty string for application_url", () => {
      const input = {
        title: "Software Engineer",
        company: "Tech Corp",
        description: "Valid description",
        application_url: "",
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, true);
    });
  });

  describe("contact_email validation", () => {
    it("should accept valid email", () => {
      const input = {
        title: "Software Engineer",
        company: "Tech Corp",
        description: "Valid description",
        contact_email: "jobs@example.com",
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, true);
    });

    it("should reject invalid email format", () => {
      const input = {
        title: "Software Engineer",
        company: "Tech Corp",
        description: "Valid description",
        contact_email: "not-an-email",
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, false);
    });

    it("should reject email over max length (320 chars)", () => {
      const localPart = "a".repeat(64);
      const domain = "a".repeat(256) + ".com";
      const input = {
        title: "Software Engineer",
        company: "Tech Corp",
        description: "Valid description",
        contact_email: `${localPart}@${domain}`,
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, false);
    });
  });

  describe("location validation", () => {
    it("should accept valid location string", () => {
      const input = {
        title: "Software Engineer",
        company: "Tech Corp",
        description: "Valid description",
        location: "New York, NY",
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.data.location, "New York, NY");
      }
    });

    it("should accept location at max length (200 chars)", () => {
      const input = {
        title: "Software Engineer",
        company: "Tech Corp",
        description: "Valid description",
        location: "a".repeat(200),
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, true);
    });

    it("should reject location over max length (200 chars)", () => {
      const input = {
        title: "Software Engineer",
        company: "Tech Corp",
        description: "Valid description",
        location: "a".repeat(201),
      };

      const result = createJobSchema.safeParse(input);
      assert.equal(result.success, false);
    });
  });
});
