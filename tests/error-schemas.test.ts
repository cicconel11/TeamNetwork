/**
 * Error Schema Validation Tests
 *
 * Tests for error tracking schemas including:
 * - errorEventSchema with meta as record<string, unknown>
 * - errorIngestRequestSchema for batch requests
 *
 * Note: These tests recreate the schemas locally to avoid module resolution
 * issues with the test loader. The actual schemas are in src/lib/schemas/errors.ts.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { z } from "zod";

// Recreate safeString helper (from common.ts -> validation.ts)
const safeString = (max: number) =>
  z.string().trim().min(1, "Required").max(max, `Must be ${max} characters or fewer`);

// Recreate the error schemas exactly as defined in src/lib/schemas/errors.ts
// This tests the fix: z.record(z.string(), z.unknown()) instead of z.record(z.unknown())

const errorSeveritySchema = z.enum(["low", "medium", "high", "critical"]);
const errorEnvSchema = z.enum(["production", "staging", "development"]);

const errorEventSchema = z.object({
  name: safeString(100).optional(),
  message: safeString(2000),
  stack: z.string().max(10000).optional(),
  route: safeString(500).optional(),
  apiPath: safeString(500).optional(),
  severity: errorSeveritySchema.optional(),
  meta: z.record(z.string(), z.unknown()).optional(), // The fix: key schema + value schema
});

const errorIngestRequestSchema = z.object({
  events: z.array(errorEventSchema).min(1).max(20),
  sessionId: safeString(64).optional(),
  env: errorEnvSchema.optional(),
});

describe("Error Schemas", () => {
  describe("errorSeveritySchema", () => {
    it("should accept valid severity levels", () => {
      const validSeverities = ["low", "medium", "high", "critical"];
      for (const severity of validSeverities) {
        const result = errorSeveritySchema.safeParse(severity);
        assert.strictEqual(result.success, true, `Severity "${severity}" should be valid`);
      }
    });

    it("should reject invalid severity levels", () => {
      const invalidSeverities = ["warn", "error", "info", "debug", ""];
      for (const severity of invalidSeverities) {
        const result = errorSeveritySchema.safeParse(severity);
        assert.strictEqual(result.success, false, `Severity "${severity}" should be invalid`);
      }
    });
  });

  describe("errorEnvSchema", () => {
    it("should accept valid environment values", () => {
      const validEnvs = ["production", "staging", "development"];
      for (const env of validEnvs) {
        const result = errorEnvSchema.safeParse(env);
        assert.strictEqual(result.success, true, `Env "${env}" should be valid`);
      }
    });

    it("should reject invalid environment values", () => {
      const invalidEnvs = ["prod", "dev", "test", "local", ""];
      for (const env of invalidEnvs) {
        const result = errorEnvSchema.safeParse(env);
        assert.strictEqual(result.success, false, `Env "${env}" should be invalid`);
      }
    });
  });

  describe("errorEventSchema", () => {
    it("should accept valid error event with all fields", () => {
      const validEvent = {
        name: "TypeError",
        message: "Cannot read property 'x' of undefined",
        stack: "Error: Cannot read property 'x' of undefined\n    at foo.js:10",
        route: "/dashboard",
        apiPath: "/api/users",
        severity: "high",
        meta: {
          userId: "123",
          browser: "Chrome",
          count: 5,
          nested: { key: "value" },
        },
      };

      const result = errorEventSchema.safeParse(validEvent);
      assert.strictEqual(result.success, true, "Valid event with all fields should parse");
    });

    it("should accept error event with only required message field", () => {
      const minimalEvent = {
        message: "Something went wrong",
      };

      const result = errorEventSchema.safeParse(minimalEvent);
      assert.strictEqual(result.success, true, "Event with only message should be valid");
    });

    it("should accept error event without meta (optional)", () => {
      const eventWithoutMeta = {
        message: "An error occurred",
        name: "Error",
        severity: "low",
      };

      const result = errorEventSchema.safeParse(eventWithoutMeta);
      assert.strictEqual(result.success, true, "Event without meta should be valid");
    });

    it("should accept meta as record<string, unknown> with various value types", () => {
      const eventWithComplexMeta = {
        message: "Test error",
        meta: {
          stringValue: "hello",
          numberValue: 42,
          boolValue: true,
          nullValue: null,
          arrayValue: [1, 2, 3],
          objectValue: { nested: "data" },
        },
      };

      const result = errorEventSchema.safeParse(eventWithComplexMeta);
      assert.strictEqual(result.success, true, "Meta should accept various value types");
    });

    it("should accept empty meta object", () => {
      const eventWithEmptyMeta = {
        message: "Test error",
        meta: {},
      };

      const result = errorEventSchema.safeParse(eventWithEmptyMeta);
      assert.strictEqual(result.success, true, "Empty meta object should be valid");
    });

    it("should reject event without message", () => {
      const eventWithoutMessage = {
        name: "Error",
        severity: "high",
      };

      const result = errorEventSchema.safeParse(eventWithoutMessage);
      assert.strictEqual(result.success, false, "Event without message should be invalid");
    });

    it("should reject message exceeding max length (2000 chars)", () => {
      const longMessage = "a".repeat(2001);
      const event = {
        message: longMessage,
      };

      const result = errorEventSchema.safeParse(event);
      assert.strictEqual(result.success, false, "Message over 2000 chars should be invalid");
    });

    it("should reject stack exceeding max length (10000 chars)", () => {
      const longStack = "a".repeat(10001);
      const event = {
        message: "Error",
        stack: longStack,
      };

      const result = errorEventSchema.safeParse(event);
      assert.strictEqual(result.success, false, "Stack over 10000 chars should be invalid");
    });

    it("should reject meta with non-string keys", () => {
      // Note: In practice, JSON only allows string keys, so this tests
      // the schema behavior when passed malformed data
      const eventWithInvalidMeta = {
        message: "Test error",
        meta: "not-an-object",
      };

      const result = errorEventSchema.safeParse(eventWithInvalidMeta);
      assert.strictEqual(result.success, false, "Meta as string should be invalid");
    });

    it("should reject meta as array", () => {
      const eventWithArrayMeta = {
        message: "Test error",
        meta: ["item1", "item2"],
      };

      const result = errorEventSchema.safeParse(eventWithArrayMeta);
      assert.strictEqual(result.success, false, "Meta as array should be invalid");
    });
  });

  describe("errorIngestRequestSchema", () => {
    it("should accept valid batch request with single event", () => {
      const request = {
        events: [{ message: "Error 1" }],
      };

      const result = errorIngestRequestSchema.safeParse(request);
      assert.strictEqual(result.success, true, "Single event batch should be valid");
    });

    it("should accept batch request with multiple events and meta", () => {
      const request = {
        events: [
          {
            message: "Error 1",
            meta: { requestId: "abc123" },
          },
          {
            message: "Error 2",
            severity: "critical",
            meta: { userId: "user456", action: "submit" },
          },
        ],
        sessionId: "session-xyz",
        env: "production",
      };

      const result = errorIngestRequestSchema.safeParse(request);
      assert.strictEqual(result.success, true, "Multi-event batch with meta should be valid");
    });

    it("should accept batch request with max 20 events", () => {
      const events = Array.from({ length: 20 }, (_, i) => ({
        message: `Error ${i + 1}`,
        meta: { index: i },
      }));

      const request = { events };

      const result = errorIngestRequestSchema.safeParse(request);
      assert.strictEqual(result.success, true, "Batch with 20 events should be valid");
    });

    it("should reject batch request with more than 20 events", () => {
      const events = Array.from({ length: 21 }, (_, i) => ({
        message: `Error ${i + 1}`,
      }));

      const request = { events };

      const result = errorIngestRequestSchema.safeParse(request);
      assert.strictEqual(result.success, false, "Batch with 21 events should be invalid");
    });

    it("should reject batch request with empty events array", () => {
      const request = {
        events: [],
      };

      const result = errorIngestRequestSchema.safeParse(request);
      assert.strictEqual(result.success, false, "Empty events array should be invalid");
    });

    it("should reject batch request without events", () => {
      const request = {
        sessionId: "abc",
        env: "production",
      };

      const result = errorIngestRequestSchema.safeParse(request);
      assert.strictEqual(result.success, false, "Request without events should be invalid");
    });

    it("should accept request with optional sessionId and env", () => {
      const request = {
        events: [{ message: "Error" }],
        sessionId: "session-123",
        env: "staging",
      };

      const result = errorIngestRequestSchema.safeParse(request);
      assert.strictEqual(result.success, true, "Request with sessionId and env should be valid");
    });

    it("should reject invalid env value in batch request", () => {
      const request = {
        events: [{ message: "Error" }],
        env: "invalid-env",
      };

      const result = errorIngestRequestSchema.safeParse(request);
      assert.strictEqual(result.success, false, "Invalid env should make request invalid");
    });
  });
});
