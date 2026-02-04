import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeErrorMessage,
  extractTopStackFrame,
  generateFingerprint,
} from "../src/lib/telemetry/fingerprint.ts";

// normalizeErrorMessage tests

test("normalizeErrorMessage replaces UUIDs with placeholder", () => {
  assert.equal(
    normalizeErrorMessage("User 550e8400-e29b-41d4-a716-446655440000 not found"),
    "User <UUID> not found"
  );
  assert.equal(
    normalizeErrorMessage("a]550e8400-e29b-41d4-a716-446655440000[b"),
    "a]<UUID>[b"
  );
});

test("normalizeErrorMessage replaces multiple UUIDs", () => {
  assert.equal(
    normalizeErrorMessage(
      "Org 550e8400-e29b-41d4-a716-446655440000 user 123e4567-e89b-12d3-a456-426614174000"
    ),
    "Org <UUID> user <UUID>"
  );
});

test("normalizeErrorMessage replaces long numeric IDs", () => {
  assert.equal(
    normalizeErrorMessage("Record 12345 not found"),
    "Record <ID> not found"
  );
  assert.equal(
    normalizeErrorMessage("ID: 9876543210"),
    "ID: <ID>"
  );
});

test("normalizeErrorMessage preserves short numeric IDs", () => {
  assert.equal(
    normalizeErrorMessage("Error code 404"),
    "Error code 404"
  );
  assert.equal(
    normalizeErrorMessage("Step 1234 failed"),
    "Step 1234 failed"
  );
});

test("normalizeErrorMessage replaces long hex strings", () => {
  assert.equal(
    normalizeErrorMessage("Hash: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"),
    "Hash: <HEX>"
  );
  assert.equal(
    normalizeErrorMessage("Token 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
    "Token <HEX>"
  );
});

test("normalizeErrorMessage replaces ISO timestamps", () => {
  assert.equal(
    normalizeErrorMessage("Error at 2024-01-15T10:30:00Z"),
    "Error at <TIMESTAMP>"
  );
  assert.equal(
    normalizeErrorMessage("Failed at 2024-01-15T10:30:00.123Z"),
    "Failed at <TIMESTAMP>"
  );
  assert.equal(
    normalizeErrorMessage("Timeout at 2024-01-15T10:30:00+05:30"),
    "Timeout at <TIMESTAMP>"
  );
  assert.equal(
    normalizeErrorMessage("Occurred 2024-01-15T10:30:00-0800"),
    "Occurred <TIMESTAMP>"
  );
});

test("normalizeErrorMessage collapses whitespace", () => {
  assert.equal(
    normalizeErrorMessage("Error   with    multiple   spaces"),
    "Error with multiple spaces"
  );
  assert.equal(
    normalizeErrorMessage("Line\n\nbreaks\tand\ttabs"),
    "Line breaks and tabs"
  );
});

test("normalizeErrorMessage trims leading/trailing whitespace", () => {
  assert.equal(
    normalizeErrorMessage("  padded message  "),
    "padded message"
  );
});

test("normalizeErrorMessage handles empty string", () => {
  assert.equal(normalizeErrorMessage(""), "");
});

test("normalizeErrorMessage handles combined patterns", () => {
  assert.equal(
    normalizeErrorMessage(
      "User 550e8400-e29b-41d4-a716-446655440000 failed at 2024-01-15T10:30:00Z with code 99999"
    ),
    "User <UUID> failed at <TIMESTAMP> with code <ID>"
  );
});

// extractTopStackFrame tests

test("extractTopStackFrame returns null for undefined stack", () => {
  assert.equal(extractTopStackFrame(undefined), null);
});

test("extractTopStackFrame returns null for empty stack", () => {
  assert.equal(extractTopStackFrame(""), null);
});

test("extractTopStackFrame skips node_modules frames", () => {
  const stack = `Error: Something failed
    at Object.handler (/app/node_modules/express/lib/router.js:123:15)
    at processRequest (/app/src/lib/api/handler.ts:45:10)`;
  assert.equal(extractTopStackFrame(stack), "/src/lib/api/handler.ts");
});

test("extractTopStackFrame skips node:internal frames", () => {
  const stack = `Error: Something failed
    at Module._compile (node:internal/modules/cjs/loader:1241:14)
    at processRequest (/app/src/lib/api/handler.ts:45:10)`;
  assert.equal(extractTopStackFrame(stack), "/src/lib/api/handler.ts");
});

test("extractTopStackFrame skips anonymous frames", () => {
  const stack = `Error: Something failed
    at <anonymous>
    at processRequest (/app/src/lib/api/handler.ts:45:10)`;
  assert.equal(extractTopStackFrame(stack), "/src/lib/api/handler.ts");
});

test("extractTopStackFrame normalizes paths to /src/", () => {
  const stack = `Error: Something failed
    at handler (/Users/dev/projects/app/src/lib/handler.ts:10:5)`;
  assert.equal(extractTopStackFrame(stack), "/src/lib/handler.ts");
});

test("extractTopStackFrame handles paths without /src/", () => {
  const stack = `Error: Something failed
    at handler (/app/lib/handler.ts:10:5)`;
  assert.equal(extractTopStackFrame(stack), "/app/lib/handler.ts");
});

test("extractTopStackFrame returns first valid frame", () => {
  const stack = `Error: Something failed
    at firstValid (/app/src/lib/first.ts:10:5)
    at secondValid (/app/src/lib/second.ts:20:10)`;
  assert.equal(extractTopStackFrame(stack), "/src/lib/first.ts");
});

test("extractTopStackFrame handles function names with methods", () => {
  const stack = `Error: Something failed
    at Object.handler (/app/src/lib/handler.ts:10:5)`;
  assert.equal(extractTopStackFrame(stack), "/src/lib/handler.ts");
});

test("extractTopStackFrame returns null when no valid frames", () => {
  const stack = `Error: Something failed
    at Object.handler (/app/node_modules/pkg/index.js:10:5)
    at Module._compile (node:internal/modules/cjs/loader:1241:14)`;
  assert.equal(extractTopStackFrame(stack), null);
});

// generateFingerprint tests

test("generateFingerprint returns consistent fingerprint for same error", () => {
  const event = {
    name: "TypeError",
    message: "Cannot read property 'foo' of undefined",
    route: "/api/users",
  };

  const result1 = generateFingerprint(event);
  const result2 = generateFingerprint(event);

  assert.equal(result1.fingerprint, result2.fingerprint);
  assert.equal(result1.fingerprint.length, 16);
});

test("generateFingerprint returns different fingerprints for different errors", () => {
  const event1 = {
    name: "TypeError",
    message: "Cannot read property 'foo' of undefined",
  };
  const event2 = {
    name: "ReferenceError",
    message: "bar is not defined",
  };

  const result1 = generateFingerprint(event1);
  const result2 = generateFingerprint(event2);

  assert.notEqual(result1.fingerprint, result2.fingerprint);
});

test("generateFingerprint normalizes dynamic values for consistent grouping", () => {
  const event1 = {
    name: "NotFoundError",
    message: "User 550e8400-e29b-41d4-a716-446655440000 not found",
  };
  const event2 = {
    name: "NotFoundError",
    message: "User 123e4567-e89b-12d3-a456-426614174000 not found",
  };

  const result1 = generateFingerprint(event1);
  const result2 = generateFingerprint(event2);

  assert.equal(result1.fingerprint, result2.fingerprint);
  assert.equal(result1.normalizedMessage, "User <UUID> not found");
});

test("generateFingerprint includes route in fingerprint calculation", () => {
  const baseEvent = {
    name: "Error",
    message: "Something failed",
  };

  const result1 = generateFingerprint({ ...baseEvent, route: "/api/users" });
  const result2 = generateFingerprint({ ...baseEvent, route: "/api/orders" });

  assert.notEqual(result1.fingerprint, result2.fingerprint);
});

test("generateFingerprint includes stack frame in fingerprint", () => {
  const baseEvent = {
    name: "Error",
    message: "Something failed",
  };

  const result1 = generateFingerprint({
    ...baseEvent,
    stack: `Error: Something failed
    at handler (/app/src/lib/users.ts:10:5)`,
  });

  const result2 = generateFingerprint({
    ...baseEvent,
    stack: `Error: Something failed
    at handler (/app/src/lib/orders.ts:10:5)`,
  });

  assert.notEqual(result1.fingerprint, result2.fingerprint);
  assert.equal(result1.topFrame, "/src/lib/users.ts");
  assert.equal(result2.topFrame, "/src/lib/orders.ts");
});

test("generateFingerprint truncates long titles to 80 chars", () => {
  const event = {
    name: "ValidationError",
    message: "X".repeat(100),
  };

  const result = generateFingerprint(event);

  assert.equal(result.title.length, 80);
  assert.ok(result.title.endsWith("..."));
});

test("generateFingerprint does not truncate short titles", () => {
  const event = {
    name: "Error",
    message: "Short message",
  };

  const result = generateFingerprint(event);

  assert.equal(result.title, "Error: Short message");
  assert.ok(!result.title.endsWith("..."));
});

test("generateFingerprint defaults error name to Error", () => {
  const event = {
    message: "Something failed",
  };

  const result = generateFingerprint(event);

  assert.ok(result.title.startsWith("Error:"));
});

test("generateFingerprint returns 16-char hex fingerprint", () => {
  const event = {
    name: "Error",
    message: "Test",
  };

  const result = generateFingerprint(event);

  assert.equal(result.fingerprint.length, 16);
  assert.match(result.fingerprint, /^[0-9a-f]{16}$/);
});

test("generateFingerprint handles missing optional fields", () => {
  const event = {
    message: "Minimal error",
  };

  const result = generateFingerprint(event);

  assert.ok(result.fingerprint);
  assert.equal(result.topFrame, null);
  assert.equal(result.normalizedMessage, "Minimal error");
});
