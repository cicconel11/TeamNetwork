import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("normalizeConstituent", () => {
  it("maps a full constituent record", async () => {
    const { normalizeConstituent } = await import("../src/lib/blackbaud/normalize");
    const result = normalizeConstituent(
      {
        id: "abc-123",
        type: "Individual",
        first: "Jane",
        last: "Doe",
        class_of: "2015",
      },
      [{ id: "e1", address: "jane@example.com", type: "Email", primary: true }],
      [{ id: "p1", number: "555-1234", type: "Mobile", primary: true }],
      [{
        id: "a1",
        address_lines: "123 Main St",
        city: "Springfield",
        state: "IL",
        postal_code: "62701",
        country: "US",
        type: "Home",
        primary: true,
      }]
    );

    assert.equal(result.external_id, "abc-123");
    assert.equal(result.first_name, "Jane");
    assert.equal(result.last_name, "Doe");
    assert.equal(result.email, "jane@example.com");
    assert.equal(result.phone_number, "555-1234");
    assert.equal(result.address_summary, "123 Main St, Springfield, IL 62701");
    assert.equal(result.graduation_year, 2015);
    assert.equal(result.source, "integration_sync");
  });

  it("handles missing sub-resources gracefully", async () => {
    const { normalizeConstituent } = await import("../src/lib/blackbaud/normalize");
    const result = normalizeConstituent(
      { id: "xyz-789", type: "Individual", first: "John", last: "Smith" },
      [],
      [],
      []
    );

    assert.equal(result.external_id, "xyz-789");
    assert.equal(result.first_name, "John");
    assert.equal(result.last_name, "Smith");
    assert.equal(result.email, null);
    assert.equal(result.phone_number, null);
    assert.equal(result.address_summary, null);
    assert.equal(result.graduation_year, null);
  });

  it("selects primary email over non-primary", async () => {
    const { normalizeConstituent } = await import("../src/lib/blackbaud/normalize");
    const result = normalizeConstituent(
      { id: "test", type: "Individual", first: "A", last: "B" },
      [
        { id: "e1", address: "secondary@example.com", type: "Email", primary: false },
        { id: "e2", address: "primary@example.com", type: "Email", primary: true },
      ],
      [],
      []
    );

    assert.equal(result.email, "primary@example.com");
  });

  it("skips inactive items", async () => {
    const { normalizeConstituent } = await import("../src/lib/blackbaud/normalize");
    const result = normalizeConstituent(
      { id: "test2", type: "Individual", first: "C", last: "D" },
      [
        { id: "e1", address: "inactive@example.com", type: "Email", primary: true, inactive: true },
        { id: "e2", address: "active@example.com", type: "Email", primary: false },
      ],
      [],
      []
    );

    assert.equal(result.email, "active@example.com");
  });

  it("returns null graduation_year for invalid class_of", async () => {
    const { normalizeConstituent } = await import("../src/lib/blackbaud/normalize");
    const result = normalizeConstituent(
      { id: "test3", type: "Individual", first: "E", last: "F", class_of: "notayear" },
      [], [], []
    );

    assert.equal(result.graduation_year, null);
  });

  it("excludes do_not_email addresses", async () => {
    const { normalizeConstituent } = await import("../src/lib/blackbaud/normalize");
    const result = normalizeConstituent(
      { id: "dne1", type: "Individual", first: "G", last: "H" },
      [
        { id: "e1", address: "optout@example.com", type: "Email", primary: true, do_not_email: true },
        { id: "e2", address: "ok@example.com", type: "Email", primary: false },
      ],
      [],
      []
    );

    assert.equal(result.email, "ok@example.com");
  });

  it("returns null email when all addresses are do_not_email", async () => {
    const { normalizeConstituent } = await import("../src/lib/blackbaud/normalize");
    const result = normalizeConstituent(
      { id: "dne2", type: "Individual", first: "I", last: "J" },
      [
        { id: "e1", address: "only@example.com", type: "Email", primary: true, do_not_email: true },
      ],
      [],
      []
    );

    assert.equal(result.email, null);
  });

  it("keeps email when do_not_email is false or undefined", async () => {
    const { normalizeConstituent } = await import("../src/lib/blackbaud/normalize");
    const result = normalizeConstituent(
      { id: "dne3", type: "Individual", first: "K", last: "L" },
      [
        { id: "e1", address: "ok@example.com", type: "Email", primary: true, do_not_email: false },
      ],
      [],
      []
    );

    assert.equal(result.email, "ok@example.com");
  });
});
