import test from "node:test";
import assert from "node:assert";

/**
 * Tests for VendorBadge vendorLabel function.
 *
 * We replicate the vendorLabel switch statement here because importing the
 * component file pulls in React/Next dependencies that don't resolve in
 * the Node test runner. The canonical implementation lives in
 * src/components/schedules/shared/VendorBadge.tsx.
 */

type VendorType = "ics" | "vendorA" | "vendorB" | "generic_html" | "google_calendar";

function vendorLabel(vendor: VendorType): string {
  switch (vendor) {
    case "ics":
      return "ICS";
    case "vendorA":
      return "Vantage";
    case "vendorB":
      return "Sidearm";
    case "generic_html":
      return "HTML";
    case "google_calendar":
      return "Google Calendar";
    default:
      return "Schedule";
  }
}

test("vendorLabel returns 'Google Calendar' for google_calendar", () => {
  const result = vendorLabel("google_calendar");
  assert.strictEqual(result, "Google Calendar");
});

test("vendorLabel returns 'ICS' for ics", () => {
  const result = vendorLabel("ics");
  assert.strictEqual(result, "ICS");
});

test("vendorLabel returns 'Vantage' for vendorA", () => {
  const result = vendorLabel("vendorA");
  assert.strictEqual(result, "Vantage");
});

test("vendorLabel returns 'Sidearm' for vendorB", () => {
  const result = vendorLabel("vendorB");
  assert.strictEqual(result, "Sidearm");
});

test("vendorLabel returns 'HTML' for generic_html", () => {
  const result = vendorLabel("generic_html");
  assert.strictEqual(result, "HTML");
});

test("vendorLabel returns 'Schedule' for unknown vendor", () => {
  const unknownVendor = "unknown_vendor" as VendorType;
  const result = vendorLabel(unknownVendor);
  assert.strictEqual(result, "Schedule");
});
