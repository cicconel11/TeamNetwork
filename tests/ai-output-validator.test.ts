import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkOutputSafety,
  validateOutput,
  withRetry,
  DEFAULT_RETRY_POLICY,
  type OutputValidationResult,
} from "../src/lib/ai/output-validator.ts";

describe("checkOutputSafety", () => {
  it("returns empty array for clean content", () => {
    const result = checkOutputSafety("Hello, here are your organization members.");
    assert.deepEqual(result, []);
  });

  it("detects SSN pattern", () => {
    const result = checkOutputSafety("Contact John at 123-45-6789 for details.");
    assert.equal(result.length, 1);
    assert(result[0].includes("SSN"));
  });

  it("detects credit card without spaces", () => {
    const result = checkOutputSafety("Card number: 4111111111111111");
    assert.equal(result.length, 1);
    assert(result[0].includes("credit_card_no_spaces"));
  });

  it("detects credit card with dashes", () => {
    const result = checkOutputSafety("Use card 4111-1111-1111-1111 for payment.");
    assert.equal(result.length, 1);
    assert(result[0].includes("credit_card_with_delimiters"));
  });

  it("detects credit card with spaces", () => {
    const result = checkOutputSafety("Card: 4111 1111 1111 1111");
    assert.equal(result.length, 1);
    assert(result[0].includes("credit_card_with_delimiters"));
  });

  it("detects multiple PII patterns", () => {
    const result = checkOutputSafety(
      "SSN: 123-45-6789, Card: 4111111111111111"
    );
    assert.equal(result.length, 2);
  });

  it("does not flag partial SSN patterns", () => {
    const result = checkOutputSafety("Phone: 123-456-7890");
    assert.deepEqual(result, []);
  });

  it("does not flag 15-digit numbers", () => {
    const result = checkOutputSafety("ID: 123456789012345");
    assert.deepEqual(result, []);
  });
});

describe("validateOutput", () => {
  it("returns valid=true, severity=none for clean content with empty tools", () => {
    const result = validateOutput({
      content: "Here are your 5 active members.",
      toolResults: [],
    });

    assert.equal(result.valid, true);
    assert.equal(result.severity, "none");
    assert.deepEqual(result.failures, []);
  });

  it("composes grounding failures with severity=warning", () => {
    // Grounding failure: claiming member count that exceeds returned rows
    const result = validateOutput({
      content: "You have 50 members: Alice, Bob, Charlie",
      toolResults: [
        {
          name: "list_members",
          data: [
            { name: "Alice", email: "alice@example.com" },
            { name: "Bob", email: "bob@example.com" },
          ],
        },
      ],
    });

    assert.equal(result.valid, false);
    assert.equal(result.severity, "warning");
    assert(result.failures.length > 0);
  });

  it("returns severity=error when PII detected", () => {
    const result = validateOutput({
      content: "Member SSN is 123-45-6789",
      toolResults: [],
    });

    assert.equal(result.valid, false);
    assert.equal(result.severity, "error");
    assert(result.failures.some((f) => f.includes("PII")));
  });

  it("combines grounding and safety failures, PII escalates to error", () => {
    const result = validateOutput({
      content: "You have 100 members. Contact via 4111111111111111",
      toolResults: [
        {
          name: "list_members",
          data: [{ name: "Test", email: "test@example.com" }],
        },
      ],
    });

    assert.equal(result.valid, false);
    assert.equal(result.severity, "error");
    // Should have both grounding and PII failures
    assert(result.failures.length >= 2);
  });
});

describe("withRetry", () => {
  it("returns immediately on valid result", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      return "success";
    };
    const validate = (): OutputValidationResult => ({
      valid: true,
      failures: [],
      severity: "none",
    });

    const { result, validation, attempts } = await withRetry(fn, validate);

    assert.equal(result, "success");
    assert.equal(validation.valid, true);
    assert.equal(attempts, 1);
    assert.equal(callCount, 1);
  });

  it("returns on warning severity without retry", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      return "warning-result";
    };
    const validate = (): OutputValidationResult => ({
      valid: false,
      failures: ["grounding issue"],
      severity: "warning",
    });

    const { result, validation, attempts } = await withRetry(fn, validate);

    assert.equal(result, "warning-result");
    assert.equal(validation.severity, "warning");
    assert.equal(attempts, 1);
    assert.equal(callCount, 1);
  });

  it("retries on error severity until success", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      return `attempt-${callCount}`;
    };
    const validate = (result: string): OutputValidationResult => {
      if (result === "attempt-2") {
        return { valid: true, failures: [], severity: "none" };
      }
      return { valid: false, failures: ["PII detected"], severity: "error" };
    };

    const policy = { maxRetries: 3, backoffMs: [1, 1, 1] };
    const { result, validation, attempts } = await withRetry(fn, validate, policy);

    assert.equal(result, "attempt-2");
    assert.equal(validation.valid, true);
    assert.equal(attempts, 2);
    assert.equal(callCount, 2);
  });

  it("exhausts retries and returns last result", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      return `fail-${callCount}`;
    };
    const validate = (): OutputValidationResult => ({
      valid: false,
      failures: ["PII pattern: SSN"],
      severity: "error",
    });

    const policy = { maxRetries: 2, backoffMs: [1, 1] };
    const { result, validation, attempts } = await withRetry(fn, validate, policy);

    assert.equal(result, "fail-3");
    assert.equal(validation.valid, false);
    assert.equal(validation.severity, "error");
    assert.equal(attempts, 3); // initial + 2 retries
    assert.equal(callCount, 3);
  });

  it("uses default policy when none provided", async () => {
    const fn = async () => "result";
    const validate = (): OutputValidationResult => ({
      valid: true,
      failures: [],
      severity: "none",
    });

    const { attempts } = await withRetry(fn, validate);
    assert.equal(attempts, 1);

    // Verify default policy exists
    assert.equal(DEFAULT_RETRY_POLICY.maxRetries, 3);
    assert.deepEqual(DEFAULT_RETRY_POLICY.backoffMs, [500, 1000, 2000]);
  });
});
