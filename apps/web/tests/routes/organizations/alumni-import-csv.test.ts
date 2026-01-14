import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  planCsvImport,
  normalizeCsvImportRows,
  buildUpdateData,
  parseCsvData,
  type CsvImportRow,
  type CsvImportPreviewStatus,
} from "@/lib/alumni/csv-import";

// ─── Schema (must match route exactly — same file, same constraints) ─────────

const importRowSchema = z.object({
  first_name: z.string().trim().min(1).max(200),
  last_name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320).optional().nullable(),
  graduation_year: z.number().int().min(1900).max(2100).optional().nullable(),
  major: z.string().trim().max(200).optional().nullable(),
  job_title: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  linkedin_url: z
    .string()
    .trim()
    .url()
    .refine((val) => val.startsWith("https://"), { message: "LinkedIn URL must use HTTPS" })
    .optional()
    .nullable(),
  phone_number: z.string().trim().max(50).optional().nullable(),
  industry: z.string().trim().max(200).optional().nullable(),
  current_company: z.string().trim().max(200).optional().nullable(),
  current_city: z.string().trim().max(200).optional().nullable(),
  position_title: z.string().trim().max(200).optional().nullable(),
});

const importBodySchema = z.object({
  rows: z.array(importRowSchema).min(1).max(500),
  overwrite: z.boolean().optional().default(false),
  dryRun: z.boolean().optional().default(false),
  sendInvites: z.boolean().optional().default(false),
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface ImportResult {
  updated: number;
  created: number;
  skipped: number;
  quotaBlocked: number;
  errors: string[];
  preview?: Record<string, CsvImportPreviewStatus>;
  emailsSent?: number;
  emailErrors?: number;
}

// ─── Helper: build preview map matching route logic ──────────────────────────

function buildPreviewMap(
  rows: CsvImportRow[],
  alumniByEmail: Map<string, { id: string; hasData: boolean }>,
  overwrite: boolean,
  remainingCapacity: number,
): ImportResult {
  const plan = planCsvImport({ rows, overwrite, alumniByEmail, remainingCapacity });

  const previewMap: Record<string, CsvImportPreviewStatus> = {};
  for (const previewRow of plan.preview) {
    previewMap[`row:${previewRow.rowIndex}`] = previewRow.status;
  }

  return {
    created: plan.toCreate.length,
    updated: plan.toUpdate.length,
    skipped: plan.skipped,
    quotaBlocked: plan.quotaBlocked,
    errors: [],
    preview: previewMap,
  };
}

// ─── Schema validation tests ──────────────────────────────────────────────────

describe("importBodySchema", () => {
  it("accepts valid import payload with required fields only", () => {
    const result = importBodySchema.safeParse({
      rows: [{ first_name: "Jane", last_name: "Smith" }],
    });
    assert.ok(result.success);
  });

  it("accepts all 13 alumni fields", () => {
    const result = importBodySchema.safeParse({
      rows: [{
        first_name: "Jane",
        last_name: "Smith",
        email: "jane@example.com",
        graduation_year: 2015,
        major: "CS",
        job_title: "Engineer",
        notes: "Notes",
        linkedin_url: "https://linkedin.com/in/jane",
        phone_number: "555-1234",
        industry: "Tech",
        current_company: "Acme",
        current_city: "Boston",
        position_title: "Director",
      }],
    });
    assert.ok(result.success);
  });

  it("defaults overwrite, dryRun, sendInvites to false", () => {
    const result = importBodySchema.safeParse({
      rows: [{ first_name: "Jane", last_name: "Smith" }],
    });
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.data.overwrite, false);
      assert.equal(result.data.dryRun, false);
      assert.equal(result.data.sendInvites, false);
    }
  });

  it("rejects empty rows array", () => {
    const result = importBodySchema.safeParse({ rows: [] });
    assert.ok(!result.success);
  });

  it("rejects more than 500 rows (matches route cap)", () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({
      first_name: "Jane",
      last_name: `Smith${i}`,
    }));
    const result = importBodySchema.safeParse({ rows });
    assert.ok(!result.success);
  });

  it("accepts exactly 500 rows", () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({
      first_name: "Jane",
      last_name: `Smith${i}`,
    }));
    const result = importBodySchema.safeParse({ rows });
    assert.ok(result.success);
  });

  it("rejects row missing first_name", () => {
    const result = importBodySchema.safeParse({
      rows: [{ last_name: "Smith" }],
    });
    assert.ok(!result.success);
  });

  it("rejects row missing last_name", () => {
    const result = importBodySchema.safeParse({
      rows: [{ first_name: "Jane" }],
    });
    assert.ok(!result.success);
  });

  it("rejects invalid email in row", () => {
    const result = importBodySchema.safeParse({
      rows: [{ first_name: "Jane", last_name: "Smith", email: "not-an-email" }],
    });
    assert.ok(!result.success);
  });

  it("rejects HTTP linkedin_url (requires HTTPS)", () => {
    const result = importBodySchema.safeParse({
      rows: [{ first_name: "Jane", last_name: "Smith", linkedin_url: "http://linkedin.com/in/jane" }],
    });
    assert.ok(!result.success);
  });

  it("accepts any HTTPS URL for linkedin_url (relaxed validation)", () => {
    const result = importBodySchema.safeParse({
      rows: [{ first_name: "Jane", last_name: "Smith", linkedin_url: "https://linkedin.com/in/jane" }],
    });
    assert.ok(result.success);
  });

  it("accepts null for optional fields", () => {
    const result = importBodySchema.safeParse({
      rows: [{ first_name: "Jane", last_name: "Smith", email: null, graduation_year: null }],
    });
    assert.ok(result.success);
  });

  it("rejects graduation_year outside valid range", () => {
    const result = importBodySchema.safeParse({
      rows: [{ first_name: "Jane", last_name: "Smith", graduation_year: 1800 }],
    });
    assert.ok(!result.success);
  });
});

// ─── Preview keying tests (Finding 1: duplicate email preview collision) ─────

describe("preview map keying (rowIndex-based)", () => {
  it("duplicate-email rows get distinct statuses (first=will_create, second=duplicate)", () => {
    const rows: CsvImportRow[] = [
      { first_name: "Alice", last_name: "A", email: "same@example.com" },
      { first_name: "Bob", last_name: "B", email: "same@example.com" },
    ];

    const result = buildPreviewMap(rows, new Map(), false, 100);

    // Row 0 should be will_create, row 1 should be duplicate
    assert.equal(result.preview!["row:0"], "will_create");
    assert.equal(result.preview!["row:1"], "duplicate");
    assert.equal(result.created, 1);
  });

  it("three duplicate-email rows: first creates, others duplicate", () => {
    const rows: CsvImportRow[] = [
      { first_name: "A", last_name: "1", email: "dup@example.com" },
      { first_name: "B", last_name: "2", email: "DUP@Example.COM" },
      { first_name: "C", last_name: "3", email: "dup@example.com" },
    ];

    const result = buildPreviewMap(rows, new Map(), false, 100);

    assert.equal(result.preview!["row:0"], "will_create");
    assert.equal(result.preview!["row:1"], "duplicate");
    assert.equal(result.preview!["row:2"], "duplicate");
    assert.equal(result.created, 1);
  });

  it("email-less rows each get their own rowIndex key", () => {
    const rows: CsvImportRow[] = [
      { first_name: "A", last_name: "1" },
      { first_name: "B", last_name: "2" },
    ];

    const result = buildPreviewMap(rows, new Map(), false, 100);

    assert.equal(result.preview!["row:0"], "will_create");
    assert.equal(result.preview!["row:1"], "will_create");
    assert.equal(result.created, 2);
  });
});

// ─── hasData tests (Finding 2: non-destructive update safety) ────────────────

describe("hasData and non-destructive updates", () => {
  it("alumni with only graduation_year is treated as having data (will_skip without overwrite)", () => {
    const rows: CsvImportRow[] = [
      { first_name: "Pat", last_name: "P", email: "pat@example.com" },
    ];

    const alumniByEmail = new Map([
      ["pat@example.com", { id: "a1", hasData: true }],
    ]);

    const result = buildPreviewMap(rows, alumniByEmail, false, 100);
    assert.equal(result.preview!["row:0"], "will_skip");
    assert.equal(result.skipped, 1);
    assert.equal(result.updated, 0);
  });

  it("alumni with no data at all (hasData=false) gets will_update even without overwrite", () => {
    const rows: CsvImportRow[] = [
      { first_name: "Empty", last_name: "Record", email: "empty@example.com" },
    ];

    const alumniByEmail = new Map([
      ["empty@example.com", { id: "a1", hasData: false }],
    ]);

    const result = buildPreviewMap(rows, alumniByEmail, false, 100);
    assert.equal(result.preview!["row:0"], "will_update");
    assert.equal(result.updated, 1);
  });

  it("overwrite=true forces will_update even when alumni has data", () => {
    const rows: CsvImportRow[] = [
      { first_name: "Pat", last_name: "P", email: "pat@example.com" },
    ];

    const alumniByEmail = new Map([
      ["pat@example.com", { id: "a1", hasData: true }],
    ]);

    const result = buildPreviewMap(rows, alumniByEmail, true, 100);
    assert.equal(result.preview!["row:0"], "will_update");
    assert.equal(result.updated, 1);
  });
});

// ─── buildUpdateData tests (Finding 2: null field stripping) ─────────────────

describe("buildUpdateData strips null fields", () => {
  it("only includes non-null fields", () => {
    const row: CsvImportRow = {
      first_name: "Jane",
      last_name: "Smith",
      email: "jane@example.com",
      graduation_year: null,
      major: null,
      job_title: "Engineer",
      notes: null,
      linkedin_url: null,
      phone_number: null,
      industry: "Tech",
      current_company: null,
      current_city: null,
      position_title: null,
    };

    const data = buildUpdateData(row);
    assert.deepEqual(data, {
      first_name: "Jane",
      last_name: "Smith",
      email: "jane@example.com",
      job_title: "Engineer",
      industry: "Tech",
    });
  });

  it("does not include graduation_year when null", () => {
    const row: CsvImportRow = {
      first_name: "A",
      last_name: "B",
      graduation_year: null,
    };

    const data = buildUpdateData(row);
    assert.equal("graduation_year" in data, false);
  });

  it("includes graduation_year when set", () => {
    const row: CsvImportRow = {
      first_name: "A",
      last_name: "B",
      graduation_year: 2015,
    };

    const data = buildUpdateData(row);
    assert.equal(data.graduation_year, 2015);
  });

  it("update payload from planCsvImport uses buildUpdateData (no null fields)", () => {
    const rows: CsvImportRow[] = [
      { first_name: "Jane", last_name: "Smith", email: "jane@example.com", major: null, industry: "Tech" },
    ];

    const alumniByEmail = new Map([
      ["jane@example.com", { id: "a1", hasData: false }],
    ]);

    const plan = planCsvImport({ rows, overwrite: false, alumniByEmail, remainingCapacity: 100 });
    assert.equal(plan.toUpdate.length, 1);

    const updateData = plan.toUpdate[0].data;
    assert.equal("major" in updateData, false, "null major should be stripped");
    assert.equal(updateData.industry, "Tech");
    assert.equal(updateData.first_name, "Jane");
  });
});

// ─── Preview (dryRun=true) tests ──────────────────────────────────────────────

describe("preview mode (dryRun=true)", () => {
  it("returns preview with correct statuses", () => {
    const rows: CsvImportRow[] = [
      { first_name: "Alice", last_name: "A", email: "alice@example.com" },
      { first_name: "Unknown", last_name: "Person", email: "unknown@example.com" },
    ];

    // Alice has no data -> will_update even without overwrite
    const alumniByEmail = new Map([
      ["alice@example.com", { id: "a1", hasData: false }],
    ]);

    const result = buildPreviewMap(rows, alumniByEmail, false, 100);
    assert.equal(result.preview!["row:0"], "will_update");
    assert.equal(result.preview!["row:1"], "will_create");
    assert.equal(result.errors.length, 0);
  });

  it("rows with overwrite=false and existing data show will_skip", () => {
    const rows: CsvImportRow[] = [
      { first_name: "Bob", last_name: "B", email: "bob@example.com" },
    ];

    const alumniByEmail = new Map([
      ["bob@example.com", { id: "a2", hasData: true }],
    ]);

    const result = buildPreviewMap(rows, alumniByEmail, false, 100);
    assert.equal(result.preview!["row:0"], "will_skip");
    assert.equal(result.skipped, 1);
    assert.equal(result.updated, 0);
  });

  it("rows with overwrite=true show will_update", () => {
    const rows: CsvImportRow[] = [
      { first_name: "Bob", last_name: "B", email: "bob@example.com" },
    ];

    const alumniByEmail = new Map([
      ["bob@example.com", { id: "a2", hasData: true }],
    ]);

    const result = buildPreviewMap(rows, alumniByEmail, true, 100);
    assert.equal(result.preview!["row:0"], "will_update");
    assert.equal(result.updated, 1);
    assert.equal(result.skipped, 0);
  });

  it("duplicate rows result in only 1 created", () => {
    const rows: CsvImportRow[] = [
      { first_name: "Alice", last_name: "A", email: "new@example.com" },
      { first_name: "Alice", last_name: "A2", email: "new@example.com" },
    ];

    const result = buildPreviewMap(rows, new Map(), false, 100);
    assert.equal(result.created, 1);
    assert.equal(result.preview!["row:0"], "will_create");
    assert.equal(result.preview!["row:1"], "duplicate");
  });

  it("email-less rows show as will_create in preview", () => {
    const rows: CsvImportRow[] = [
      { first_name: "Jane", last_name: "No-Email" },
    ];

    const result = buildPreviewMap(rows, new Map(), false, 100);
    assert.equal(result.preview!["row:0"], "will_create");
    assert.equal(result.created, 1);
  });
});

// ─── Import execution (dryRun=false) via planCsvImport ──────────────────────

describe("import execution (via planCsvImport)", () => {
  it("plans updates and creates correctly", () => {
    const rows: CsvImportRow[] = [
      { first_name: "Alice", last_name: "A", email: "alice@example.com" },
      { first_name: "Unknown", last_name: "Person", email: "unknown@example.com" },
    ];

    // Alice has no data -> will_update
    const alumniByEmail = new Map([
      ["alice@example.com", { id: "a1", hasData: false }],
    ]);

    const plan = planCsvImport({ rows, overwrite: false, alumniByEmail, remainingCapacity: 100 });
    assert.equal(plan.toUpdate.length, 1);
    assert.equal(plan.toCreate.length, 1);
    assert.equal(plan.skipped, 0);
  });

  it("handles all-new rows correctly", () => {
    const rows: CsvImportRow[] = [
      { first_name: "New", last_name: "Person1", email: "new1@example.com" },
      { first_name: "New", last_name: "Person2", email: "new2@example.com" },
    ];

    const plan = planCsvImport({ rows, overwrite: false, alumniByEmail: new Map(), remainingCapacity: 100 });
    assert.equal(plan.toCreate.length, 2);
    assert.equal(plan.toUpdate.length, 0);
    assert.equal(plan.skipped, 0);
    assert.equal(plan.quotaBlocked, 0);
  });

  it("quota blocking applies", () => {
    const rows: CsvImportRow[] = [
      { first_name: "A", last_name: "1", email: "a1@example.com" },
      { first_name: "A", last_name: "2", email: "a2@example.com" },
      { first_name: "A", last_name: "3", email: "a3@example.com" },
    ];

    const plan = planCsvImport({ rows, overwrite: false, alumniByEmail: new Map(), remainingCapacity: 2 });
    assert.equal(plan.toCreate.length, 2);
    assert.equal(plan.quotaBlocked, 1);
  });
});

// ─── Quota tests ──────────────────────────────────────────────────────────────

describe("alumni quota enforcement", () => {
  it("marks all new rows as quota_blocked when at capacity", () => {
    const rows: CsvImportRow[] = [
      { first_name: "A", last_name: "1", email: "a1@example.com" },
      { first_name: "A", last_name: "2", email: "a2@example.com" },
    ];

    const result = buildPreviewMap(rows, new Map(), false, 0);
    assert.equal(result.created, 0);
    assert.equal(result.quotaBlocked, 2);
    assert.equal(result.preview!["row:0"], "quota_blocked");
    assert.equal(result.preview!["row:1"], "quota_blocked");
  });

  it("partial quota: creates some, blocks rest", () => {
    const rows: CsvImportRow[] = [
      { first_name: "A", last_name: "1", email: "a1@example.com" },
      { first_name: "A", last_name: "2", email: "a2@example.com" },
      { first_name: "A", last_name: "3", email: "a3@example.com" },
    ];

    const result = buildPreviewMap(rows, new Map(), false, 1);
    assert.equal(result.created, 1);
    assert.equal(result.quotaBlocked, 2);
  });

  it("unlimited quota (Infinity) allows all creates", () => {
    const rows: CsvImportRow[] = Array.from({ length: 10 }, (_, i) => ({
      first_name: "Person",
      last_name: `${i}`,
      email: `person${i}@example.com`,
    }));

    const result = buildPreviewMap(rows, new Map(), false, Infinity);
    assert.equal(result.created, 10);
    assert.equal(result.quotaBlocked, 0);
  });

  it("updates do not count against quota", () => {
    const rows: CsvImportRow[] = [
      { first_name: "Alice", last_name: "A", email: "alice@example.com", notes: "Updated" },
    ];

    const alumniByEmail = new Map([
      ["alice@example.com", { id: "a1", hasData: true }],
    ]);

    // overwrite=true, capacity=0 — update should still work
    const result = buildPreviewMap(rows, alumniByEmail, true, 0);
    assert.equal(result.updated, 1);
    assert.equal(result.created, 0);
    assert.equal(result.quotaBlocked, 0);
  });
});

// ─── normalizeCsvImportRows edge cases ───────────────────────────────────────

describe("normalizeCsvImportRows edge cases", () => {
  it("email-less rows from CSV do not cause duplicates to be dropped", () => {
    const rows: CsvImportRow[] = [
      { first_name: "A", last_name: "1" },
      { first_name: "B", last_name: "2" },
      { first_name: "A", last_name: "1-dup" },
    ];
    const { rows: deduped } = normalizeCsvImportRows(rows);
    assert.equal(deduped.length, 3);
  });

  it("case-insensitive email dedup works in plan", () => {
    const rows: CsvImportRow[] = [
      { first_name: "A", last_name: "1", email: "Alice@Example.COM" },
      { first_name: "A", last_name: "1-dup", email: "alice@example.com" },
      { first_name: "B", last_name: "2", email: "bob@example.com" },
    ];

    const plan = planCsvImport({ rows, overwrite: false, alumniByEmail: new Map(), remainingCapacity: 100 });
    assert.equal(plan.toCreate.length, 2);
    assert.equal(plan.preview.filter((p) => p.status === "duplicate").length, 1);
  });
});

// ─── RFC 4180 embedded newline test (Finding 3) ──────────────────────────────

describe("parseCsvData RFC 4180 embedded newlines", () => {
  it("handles quoted fields with embedded newlines", () => {
    const csv = [
      "first_name,last_name,notes",
      'Jane,Smith,"Line 1',
      'Line 2',
      'Line 3"',
      "Bob,Jones,Simple note",
    ].join("\n");

    const rows = parseCsvData(csv);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].first_name, "Jane");
    assert.equal(rows[0].notes, "Line 1\nLine 2\nLine 3");
    assert.equal(rows[1].first_name, "Bob");
    assert.equal(rows[1].notes, "Simple note");
  });

  it("handles quoted fields with embedded newlines and commas", () => {
    const csv = [
      "first_name,last_name,notes",
      '"Jane","Smith","Notes with, comma',
      'and newline"',
      "Bob,Jones,ok",
    ].join("\n");

    const rows = parseCsvData(csv);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].first_name, "Jane");
    assert.equal(rows[0].notes, "Notes with, comma\nand newline");
    assert.equal(rows[1].first_name, "Bob");
  });

  it("handles escaped quotes within embedded newline fields", () => {
    const csv = 'first_name,last_name,notes\nJane,Smith,"She said ""hello""\nand left"\nBob,Jones,ok';

    const rows = parseCsvData(csv);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].notes, 'She said "hello"\nand left');
  });

  it("handles CRLF line endings within quoted fields", () => {
    const csv = "first_name,last_name,notes\r\nJane,Smith,\"Line 1\r\nLine 2\"\r\nBob,Jones,ok";

    const rows = parseCsvData(csv);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].notes, "Line 1\r\nLine 2");
    assert.equal(rows[1].first_name, "Bob");
  });
});
