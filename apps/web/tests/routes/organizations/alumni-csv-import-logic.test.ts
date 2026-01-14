import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseCsvData,
  normalizeCsvImportRows,
  planCsvImport,
  generateCsvTemplate,
  type CsvImportRow,
} from "@/lib/alumni/csv-import";

// ---------------------------------------------------------------------------
// parseCsvData
// ---------------------------------------------------------------------------

describe("parseCsvData", () => {
  it("returns empty array for empty input", () => {
    assert.deepEqual(parseCsvData(""), []);
  });

  it("returns empty array when only a header row is present", () => {
    assert.deepEqual(parseCsvData("first_name,last_name"), []);
  });

  it("parses comma-delimited CSV with canonical headers", () => {
    const csv = [
      "first_name,last_name,email",
      "Jane,Smith,jane@example.com",
    ].join("\n");

    const rows = parseCsvData(csv);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].first_name, "Jane");
    assert.equal(rows[0].last_name, "Smith");
    assert.equal(rows[0].email, "jane@example.com");
  });

  it("parses tab-delimited TSV with headers", () => {
    const tsv = "first_name\tlast_name\temail\nAlex\tJones\talex@example.com";
    const rows = parseCsvData(tsv);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].first_name, "Alex");
    assert.equal(rows[0].last_name, "Jones");
    assert.equal(rows[0].email, "alex@example.com");
  });

  it("handles RFC 4180 quoted fields containing commas", () => {
    const csv = [
      "first_name,last_name,notes",
      'Jane,Smith,"Hello, world"',
    ].join("\n");

    const rows = parseCsvData(csv);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].notes, "Hello, world");
  });

  it("handles RFC 4180 escaped double quotes inside quoted fields", () => {
    const csv = [
      "first_name,last_name,notes",
      'Jane,Smith,"She said ""hi"""',
    ].join("\n");

    const rows = parseCsvData(csv);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].notes, 'She said "hi"');
  });

  it("handles RFC 4180 quoted fields with embedded newlines", () => {
    const csv = "first_name,last_name,notes\nJane,Smith,\"Line 1\nLine 2\nLine 3\"\nBob,Jones,Simple";

    const rows = parseCsvData(csv);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].first_name, "Jane");
    assert.equal(rows[0].notes, "Line 1\nLine 2\nLine 3");
    assert.equal(rows[1].first_name, "Bob");
    assert.equal(rows[1].notes, "Simple");
  });

  it("handles flexible headers: 'First Name' -> first_name", () => {
    const csv = "First Name,Last Name,Email Address\nJane,Smith,jane@example.com";
    const rows = parseCsvData(csv);
    assert.equal(rows[0].first_name, "Jane");
    assert.equal(rows[0].last_name, "Smith");
    assert.equal(rows[0].email, "jane@example.com");
  });

  it("handles flexible headers: 'LinkedIn URL' -> linkedin_url", () => {
    const csv = "first_name,last_name,LinkedIn URL\nJane,Smith,https://linkedin.com/in/jane";
    const rows = parseCsvData(csv);
    assert.equal(rows[0].linkedin_url, "https://linkedin.com/in/jane");
  });

  it("handles flexible headers: 'Company' -> current_company", () => {
    const csv = "first_name,last_name,Company\nJane,Smith,Acme";
    const rows = parseCsvData(csv);
    assert.equal(rows[0].current_company, "Acme");
  });

  it("handles flexible headers: 'City' -> current_city", () => {
    const csv = "first_name,last_name,City\nJane,Smith,Boston";
    const rows = parseCsvData(csv);
    assert.equal(rows[0].current_city, "Boston");
  });

  it("handles flexible headers: 'Class Year' -> graduation_year", () => {
    const csv = "first_name,last_name,Class Year\nJane,Smith,2018";
    const rows = parseCsvData(csv);
    assert.equal(rows[0].graduation_year, 2018);
  });

  it("normalizes empty strings to null", () => {
    const csv = "first_name,last_name,email,notes\nJane,Smith,,";
    const rows = parseCsvData(csv);
    assert.equal(rows[0].email, null);
    assert.equal(rows[0].notes, null);
  });

  it("skips empty lines", () => {
    const csv = "first_name,last_name\nJane,Smith\n\nBob,Jones\n";
    const rows = parseCsvData(csv);
    assert.equal(rows.length, 2);
  });

  it("skips rows missing required first_name or last_name", () => {
    const csv = "first_name,last_name,email\n,Smith,a@b.com\nJane,,b@c.com";
    const rows = parseCsvData(csv);
    assert.equal(rows.length, 0);
  });

  it("parses graduation_year as a number", () => {
    const csv = "first_name,last_name,graduation_year\nJane,Smith,2020";
    const rows = parseCsvData(csv);
    assert.equal(typeof rows[0].graduation_year, "number");
    assert.equal(rows[0].graduation_year, 2020);
  });

  it("normalizes non-numeric graduation_year to null", () => {
    const csv = "first_name,last_name,graduation_year\nJane,Smith,abc";
    const rows = parseCsvData(csv);
    assert.equal(rows[0].graduation_year, null);
  });

  it("handles 'Title' header -> position_title", () => {
    const csv = "first_name,last_name,Title\nJane,Smith,Director";
    const rows = parseCsvData(csv);
    assert.equal(rows[0].position_title, "Director");
  });

  it("handles 'Phone' header -> phone_number", () => {
    const csv = "first_name,last_name,Phone\nJane,Smith,555-1234";
    const rows = parseCsvData(csv);
    assert.equal(rows[0].phone_number, "555-1234");
  });
});

// ---------------------------------------------------------------------------
// normalizeCsvImportRows
// ---------------------------------------------------------------------------

describe("normalizeCsvImportRows", () => {
  function row(overrides: Partial<CsvImportRow> & Pick<CsvImportRow, "first_name" | "last_name">): CsvImportRow {
    return { first_name: "Jane", last_name: "Smith", ...overrides };
  }

  it("deduplicates rows with the same email (case-insensitive, first wins)", () => {
    const rows = [
      row({ email: "jane@example.com" }),
      row({ email: "JANE@EXAMPLE.COM", notes: "dup" }),
    ];
    const { rows: deduped, duplicateIndices } = normalizeCsvImportRows(rows);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0].notes, undefined);
    assert.equal(duplicateIndices.size, 1);
    assert.equal(duplicateIndices.get(1), 0);
  });

  it("keeps all email-less rows (never deduped)", () => {
    const rows = [
      row({ first_name: "Alice", last_name: "A" }),
      row({ first_name: "Bob", last_name: "B" }),
      row({ first_name: "Carol", last_name: "C" }),
    ];
    const { rows: deduped, duplicateIndices } = normalizeCsvImportRows(rows);
    assert.equal(deduped.length, 3);
    assert.equal(duplicateIndices.size, 0);
  });

  it("handles mixed: email rows deduped, email-less rows all kept", () => {
    const rows = [
      row({ email: "a@example.com" }),
      row({ email: null }),
      row({ email: "A@EXAMPLE.COM" }),
      row({ email: null }),
    ];
    const { rows: deduped } = normalizeCsvImportRows(rows);
    // email rows: 1 unique + 1 duplicate -> 1 kept; email-less: 2 kept
    assert.equal(deduped.length, 3);
  });

  it("lowercases retained email addresses", () => {
    const rows = [row({ email: "UPPER@EXAMPLE.COM" })];
    const { rows: deduped } = normalizeCsvImportRows(rows);
    assert.equal(deduped[0].email, "upper@example.com");
  });
});

// ---------------------------------------------------------------------------
// planCsvImport
// ---------------------------------------------------------------------------

describe("planCsvImport", () => {
  function row(overrides: Partial<CsvImportRow> = {}): CsvImportRow {
    return { first_name: "Jane", last_name: "Smith", email: "jane@example.com", ...overrides };
  }

  it("classifies new rows (no email match) as will_create", () => {
    const result = planCsvImport({
      rows: [row()],
      overwrite: false,
      alumniByEmail: new Map(),
      remainingCapacity: 10,
    });
    assert.equal(result.toCreate.length, 1);
    assert.equal(result.preview[0].status, "will_create");
    assert.equal(result.skipped, 0);
    assert.equal(result.quotaBlocked, 0);
  });

  it("classifies existing matches with overwrite=false as will_skip", () => {
    const alumniByEmail = new Map([["jane@example.com", { id: "abc", hasData: true }]]);
    const result = planCsvImport({
      rows: [row()],
      overwrite: false,
      alumniByEmail,
      remainingCapacity: 10,
    });
    assert.equal(result.toCreate.length, 0);
    assert.equal(result.toUpdate.length, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.preview[0].status, "will_skip");
  });

  it("classifies existing matches with overwrite=true as will_update", () => {
    const alumniByEmail = new Map([["jane@example.com", { id: "abc", hasData: true }]]);
    const result = planCsvImport({
      rows: [row()],
      overwrite: true,
      alumniByEmail,
      remainingCapacity: 10,
    });
    assert.equal(result.toUpdate.length, 1);
    assert.equal(result.toUpdate[0].alumniId, "abc");
    assert.equal(result.preview[0].status, "will_update");
  });

  it("marks rows exceeding capacity as quota_blocked", () => {
    const rows = [
      row({ email: "a@example.com" }),
      row({ email: "b@example.com" }),
      row({ email: "c@example.com" }),
    ];
    const result = planCsvImport({
      rows,
      overwrite: false,
      alumniByEmail: new Map(),
      remainingCapacity: 2,
    });
    assert.equal(result.toCreate.length, 2);
    assert.equal(result.quotaBlocked, 1);
    assert.equal(result.preview[2].status, "quota_blocked");
  });

  it("classifies email-less rows as will_create within capacity", () => {
    const rows = [
      { first_name: "Alice", last_name: "A" },
      { first_name: "Bob", last_name: "B" },
    ];
    const result = planCsvImport({
      rows,
      overwrite: false,
      alumniByEmail: new Map(),
      remainingCapacity: 5,
    });
    assert.equal(result.toCreate.length, 2);
    assert.equal(result.preview[0].status, "will_create");
    assert.equal(result.preview[1].status, "will_create");
  });

  it("marks duplicate rows as duplicate in preview", () => {
    const rows = [
      row({ email: "jane@example.com" }),
      row({ email: "jane@example.com", notes: "dup" }),
    ];
    const result = planCsvImport({
      rows,
      overwrite: false,
      alumniByEmail: new Map(),
      remainingCapacity: 10,
    });
    const statuses = result.preview.map((r) => r.status);
    assert.ok(statuses.includes("will_create"));
    assert.ok(statuses.includes("duplicate"));
    assert.equal(result.toCreate.length, 1);
  });
});

// ---------------------------------------------------------------------------
// generateCsvTemplate
// ---------------------------------------------------------------------------

describe("generateCsvTemplate", () => {
  it("returns a non-empty string", () => {
    const template = generateCsvTemplate();
    assert.ok(template.length > 0);
  });

  it("contains required headers first_name and last_name", () => {
    const template = generateCsvTemplate();
    const headerLine = template.split(/\r\n|\r|\n/)[0];
    assert.ok(headerLine.includes("first_name"), "missing first_name header");
    assert.ok(headerLine.includes("last_name"), "missing last_name header");
  });

  it("contains all 13 expected headers", () => {
    const expectedHeaders = [
      "first_name",
      "last_name",
      "email",
      "graduation_year",
      "major",
      "job_title",
      "notes",
      "linkedin_url",
      "phone_number",
      "industry",
      "current_company",
      "current_city",
      "position_title",
    ];
    const template = generateCsvTemplate();
    const headerLine = template.split(/\r\n|\r|\n/)[0];
    for (const h of expectedHeaders) {
      assert.ok(headerLine.includes(h), `missing header: ${h}`);
    }
  });

  it("includes an example data row", () => {
    const template = generateCsvTemplate();
    const lines = template.split(/\r\n|\r|\n/).filter(Boolean);
    assert.ok(lines.length >= 2, "should have at least a header row and one example row");
  });
});
