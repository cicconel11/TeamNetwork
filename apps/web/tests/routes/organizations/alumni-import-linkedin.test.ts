import test, { describe } from "node:test";
import assert from "node:assert";
import { z } from "zod";
import {
  deriveNameFromEmail,
  planLinkedInImport,
  type LinkedInImportMatch,
} from "@/lib/alumni/linkedin-import";

// ─── Schema (mirrors route schema) ───────────────────────────────────────────

const linkedinUrlSchema = z
  .string()
  .trim()
  .transform((val) => {
    try {
      const url = new URL(val);
      if (url.protocol === "http:") {
        url.protocol = "https:";
      }
      if (url.hostname === "linkedin.com") {
        url.hostname = "www.linkedin.com";
      }
      return url.toString().replace(/\/+$/, "");
    } catch {
      return val;
    }
  })
  .refine(
    (val) => {
      try {
        const url = new URL(val);
        return (
          url.protocol === "https:" &&
          url.hostname === "www.linkedin.com" &&
          /^\/in\/[a-zA-Z0-9_-]+/.test(url.pathname)
        );
      } catch {
        return false;
      }
    },
    { message: "Must be a valid LinkedIn profile URL (linkedin.com/in/...)" },
  );

const importRowSchema = z.object({
  email: z.string().trim().email().max(320),
  linkedin_url: linkedinUrlSchema,
});

const importBodySchema = z.object({
  rows: z.array(importRowSchema).min(1).max(500),
  overwrite: z.boolean().optional().default(false),
  dryRun: z.boolean().optional().default(false),
});

// ─── Types ───────────────────────────────────────────────────────────────────

type PreviewStatus = "will_update" | "will_skip" | "quota_blocked" | "will_create";

interface ImportResult {
  updated: number;
  created: number;
  skipped: number;
  quotaBlocked: number;
  errors: string[];
  preview?: Record<string, PreviewStatus>;
}

interface AlumniRow {
  id: string;
  email: string | null;
  linkedin_url: string | null;
  organization_id: string;
  user_id?: string | null;
}

interface AuthUser {
  id: string;
  email: string;
}

interface ImportRequest {
  userId: string | null;
  role: string | null;
  organizationId: string;
  body: unknown;
  alumniRows: AlumniRow[];
  authUsers?: AuthUser[];
  alumniLimit?: number | null;
  currentAlumniCount?: number;
}

// ─── Simulate route logic (pure function extracted from route) ───────────────

function simulateImport(req: ImportRequest): { status: number; body: Record<string, unknown> } {
  if (!req.userId) {
    return { status: 401, body: { error: "Unauthorized" } };
  }

  if (req.role !== "admin") {
    return { status: 403, body: { error: "Forbidden" } };
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(req.organizationId)) {
    return { status: 400, body: { error: "Invalid organization id" } };
  }

  const parsed = importBodySchema.safeParse(req.body);
  if (!parsed.success) {
    const details = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "body"}: ${issue.message}`,
    );
    return { status: 400, body: { error: "Invalid request body", details } };
  }

  const { rows, overwrite, dryRun } = parsed.data;

  // Build email→alumni lookup from DB rows
  const alumniByEmail = new Map<string, AlumniRow>();
  for (const alumni of req.alumniRows) {
    if (alumni.email) {
      alumniByEmail.set(alumni.email.toLowerCase(), alumni);
    }
  }

  // Fallback: look up unmatched emails via auth.users → alumni.user_id
  const emails = rows.map((r) => r.email.toLowerCase());
  const unmatchedEmails = emails.filter((e) => !alumniByEmail.has(e));

  if (unmatchedEmails.length > 0 && req.authUsers) {
    const matchedAuthUsers = req.authUsers.filter((u) =>
      unmatchedEmails.includes(u.email.toLowerCase()),
    );

    if (matchedAuthUsers.length > 0) {
      const userIdToEmail = new Map(
        matchedAuthUsers.map((u) => [u.id, u.email.toLowerCase()]),
      );

      const linkedAlumni = req.alumniRows.filter(
        (a) =>
          a.user_id &&
          userIdToEmail.has(a.user_id) &&
          a.organization_id === req.organizationId,
      );

      for (const alum of linkedAlumni) {
        const email = userIdToEmail.get(alum.user_id!);
        if (email && !alumniByEmail.has(email)) {
          alumniByEmail.set(email, alum);
        }
      }
    }
  }

  // Quota check
  const alumniLimit = req.alumniLimit ?? null;
  const currentAlumniCount = req.currentAlumniCount ?? req.alumniRows.length;
  const remainingCapacity = alumniLimit === null
    ? Infinity
    : alumniLimit - currentAlumniCount;

  const plan = planLinkedInImport({
    rows,
    overwrite,
    dryRun,
    alumniByEmail: new Map<string, LinkedInImportMatch>(
      Array.from(alumniByEmail.entries()).map(([email, alumni]) => [
        email,
        { id: alumni.id, linkedin_url: alumni.linkedin_url },
      ]),
    ),
    remainingCapacity,
  });

  const result: ImportResult = {
    updated: plan.toUpdate.length,
    created: plan.toCreate.length,
    skipped: plan.skipped,
    quotaBlocked: plan.quotaBlocked,
    errors: [],
  };

  if (dryRun) {
    result.preview = plan.preview as Record<string, PreviewStatus>;
  }

  return { status: 200, body: result as unknown as Record<string, unknown> };
}

// ─── Schema validation tests ─────────────────────────────────────────────────

describe("importBodySchema", () => {
  test("accepts valid import payload", () => {
    const result = importBodySchema.safeParse({
      rows: [{ email: "alice@example.com", linkedin_url: "https://www.linkedin.com/in/alice" }],
    });
    assert.strictEqual(result.success, true);
  });

  test("defaults overwrite to false", () => {
    const result = importBodySchema.safeParse({
      rows: [{ email: "alice@example.com", linkedin_url: "https://www.linkedin.com/in/alice" }],
    });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.overwrite, false);
    }
  });

  test("defaults dryRun to false", () => {
    const result = importBodySchema.safeParse({
      rows: [{ email: "alice@example.com", linkedin_url: "https://www.linkedin.com/in/alice" }],
    });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.dryRun, false);
    }
  });

  test("rejects empty rows array", () => {
    const result = importBodySchema.safeParse({ rows: [] });
    assert.strictEqual(result.success, false);
  });

  test("rejects more than 500 rows", () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({
      email: `user${i}@example.com`,
      linkedin_url: `https://www.linkedin.com/in/user${i}`,
    }));
    const result = importBodySchema.safeParse({ rows });
    assert.strictEqual(result.success, false);
  });

  test("rejects invalid email", () => {
    const result = importBodySchema.safeParse({
      rows: [{ email: "not-an-email", linkedin_url: "https://www.linkedin.com/in/alice" }],
    });
    assert.strictEqual(result.success, false);
  });

  test("rejects non-LinkedIn URL", () => {
    const result = importBodySchema.safeParse({
      rows: [{ email: "alice@example.com", linkedin_url: "https://twitter.com/alice" }],
    });
    assert.strictEqual(result.success, false);
  });

  test("normalizes http to https", () => {
    const result = importBodySchema.safeParse({
      rows: [{ email: "alice@example.com", linkedin_url: "http://www.linkedin.com/in/alice" }],
    });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.rows[0].linkedin_url, "https://www.linkedin.com/in/alice");
    }
  });

  test("normalizes linkedin.com to www.linkedin.com", () => {
    const result = importBodySchema.safeParse({
      rows: [{ email: "alice@example.com", linkedin_url: "https://linkedin.com/in/alice" }],
    });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.rows[0].linkedin_url, "https://www.linkedin.com/in/alice");
    }
  });

  test("strips trailing slash from LinkedIn URL", () => {
    const result = importBodySchema.safeParse({
      rows: [{ email: "alice@example.com", linkedin_url: "https://www.linkedin.com/in/alice/" }],
    });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.rows[0].linkedin_url, "https://www.linkedin.com/in/alice");
    }
  });
});

// ─── Auth tests ──────────────────────────────────────────────────────────────

describe("auth enforcement", () => {
  test("unauthenticated request returns 401", () => {
    const result = simulateImport({
      userId: null,
      role: null,
      organizationId: "00000000-0000-0000-0000-000000000001",
      body: { rows: [{ email: "a@b.com", linkedin_url: "https://www.linkedin.com/in/a" }] },
      alumniRows: [],
    });
    assert.strictEqual(result.status, 401);
  });

  test("active_member returns 403", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "active_member",
      organizationId: "00000000-0000-0000-0000-000000000001",
      body: { rows: [{ email: "a@b.com", linkedin_url: "https://www.linkedin.com/in/a" }] },
      alumniRows: [],
    });
    assert.strictEqual(result.status, 403);
  });

  test("alumni role returns 403", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "alumni",
      organizationId: "00000000-0000-0000-0000-000000000001",
      body: { rows: [{ email: "a@b.com", linkedin_url: "https://www.linkedin.com/in/a" }] },
      alumniRows: [],
    });
    assert.strictEqual(result.status, 403);
  });

  test("invalid organization ID returns 400", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: "not-a-uuid",
      body: { rows: [{ email: "a@b.com", linkedin_url: "https://www.linkedin.com/in/a" }] },
      alumniRows: [],
    });
    assert.strictEqual(result.status, 400);
  });
});

// ─── Dry run tests ───────────────────────────────────────────────────────────

describe("dry run", () => {
  const ORG_ID = "00000000-0000-0000-0000-000000000001";

  const alumniRows: AlumniRow[] = [
    { id: "a1", email: "alice@example.com", linkedin_url: null, organization_id: ORG_ID },
    { id: "a2", email: "bob@example.com", linkedin_url: "https://www.linkedin.com/in/bob-existing", organization_id: ORG_ID },
    { id: "a3", email: "carol@example.com", linkedin_url: null, organization_id: ORG_ID },
  ];

  test("dryRun=true returns counts without modifying data", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        rows: [
          { email: "alice@example.com", linkedin_url: "https://www.linkedin.com/in/alice" },
          { email: "unknown@example.com", linkedin_url: "https://www.linkedin.com/in/unknown" },
        ],
        dryRun: true,
      },
      alumniRows,
    });

    assert.strictEqual(result.status, 200);
    const body = result.body as unknown as ImportResult;
    assert.strictEqual(body.updated, 1);
    assert.strictEqual(body.created, 1);
    assert.strictEqual(body.quotaBlocked, 0);
    assert.ok(body.preview);
  });

  test("preview map has correct per-email statuses", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        rows: [
          { email: "alice@example.com", linkedin_url: "https://www.linkedin.com/in/alice" },
          { email: "bob@example.com", linkedin_url: "https://www.linkedin.com/in/bob-new" },
          { email: "unknown@example.com", linkedin_url: "https://www.linkedin.com/in/unknown" },
        ],
        dryRun: true,
      },
      alumniRows,
    });

    const body = result.body as unknown as ImportResult;
    assert.ok(body.preview);
    assert.strictEqual(body.preview["alice@example.com"], "will_update");
    assert.strictEqual(body.preview["bob@example.com"], "will_skip");
    assert.strictEqual(body.preview["unknown@example.com"], "will_create");
  });

  test("preview map keys are lowercased", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        rows: [
          { email: "Alice@Example.COM", linkedin_url: "https://www.linkedin.com/in/alice" },
        ],
        dryRun: true,
      },
      alumniRows,
    });

    const body = result.body as unknown as ImportResult;
    assert.ok(body.preview);
    assert.strictEqual(body.preview["alice@example.com"], "will_update");
    assert.strictEqual(body.preview["Alice@Example.COM"], undefined);
  });

  test("dryRun=false does not return preview field", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        rows: [
          { email: "alice@example.com", linkedin_url: "https://www.linkedin.com/in/alice" },
        ],
        dryRun: false,
      },
      alumniRows,
    });

    const body = result.body as unknown as ImportResult;
    assert.strictEqual(body.preview, undefined);
  });

  test("overwrite flag changes will_skip to will_update in preview", () => {
    const withoutOverwrite = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        rows: [
          { email: "bob@example.com", linkedin_url: "https://www.linkedin.com/in/bob-new" },
        ],
        dryRun: true,
        overwrite: false,
      },
      alumniRows,
    });

    const bodyWithout = withoutOverwrite.body as unknown as ImportResult;
    assert.ok(bodyWithout.preview);
    assert.strictEqual(bodyWithout.preview["bob@example.com"], "will_skip");
    assert.strictEqual(bodyWithout.skipped, 1);
    assert.strictEqual(bodyWithout.updated, 0);

    const withOverwrite = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        rows: [
          { email: "bob@example.com", linkedin_url: "https://www.linkedin.com/in/bob-new" },
        ],
        dryRun: true,
        overwrite: true,
      },
      alumniRows,
    });

    const bodyWith = withOverwrite.body as unknown as ImportResult;
    assert.ok(bodyWith.preview);
    assert.strictEqual(bodyWith.preview["bob@example.com"], "will_update");
    assert.strictEqual(bodyWith.skipped, 0);
    assert.strictEqual(bodyWith.updated, 1);
  });

  test("all rows unmatched with unlimited quota creates all", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        rows: [
          { email: "x@example.com", linkedin_url: "https://www.linkedin.com/in/x" },
          { email: "y@example.com", linkedin_url: "https://www.linkedin.com/in/y" },
        ],
        dryRun: true,
      },
      alumniRows,
    });

    const body = result.body as unknown as ImportResult;
    assert.strictEqual(body.updated, 0);
    assert.strictEqual(body.created, 2);
    assert.strictEqual(body.quotaBlocked, 0);
    assert.ok(body.preview);
    assert.strictEqual(body.preview["x@example.com"], "will_create");
    assert.strictEqual(body.preview["y@example.com"], "will_create");
  });
});

// ─── Spreadsheet parsing tests ───────────────────────────────────────────────

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  if (firstLine.includes("\t")) return "\t";
  return ",";
}

interface ParsedRow {
  email: string;
  linkedin_url: string;
  status: string;
}

function parseSpreadsheetData(text: string): ParsedRow[] {
  const LINKEDIN_URL_PATTERN = /^https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/;
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(text);
  const firstLine = lines[0].toLowerCase();
  const startIndex = firstLine.includes("email") && firstLine.includes("linkedin") ? 1 : 0;

  const seenEmails = new Set<string>();
  const rows: ParsedRow[] = [];

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(delimiter).map((s: string) => s.trim().replace(/^"|"$/g, ""));
    if (parts.length < 2) continue;

    const [email, linkedin_url] = parts;
    const emailKey = email.toLowerCase();

    let status = "valid";
    if (!LINKEDIN_URL_PATTERN.test(linkedin_url)) {
      status = "invalid_url";
    } else if (seenEmails.has(emailKey)) {
      status = "duplicate";
    }

    seenEmails.add(emailKey);
    rows.push({ email, linkedin_url, status });
  }

  return rows;
}

describe("spreadsheet parsing", () => {
  test("parses comma-separated CSV", () => {
    const csv = "email,linkedin_url\nalice@example.com,https://www.linkedin.com/in/alice\nbob@example.com,https://www.linkedin.com/in/bob";
    const rows = parseSpreadsheetData(csv);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].email, "alice@example.com");
    assert.strictEqual(rows[1].email, "bob@example.com");
  });

  test("parses tab-separated data (Google Sheets / Excel paste)", () => {
    const tsv = "email\tlinkedin_url\nalice@example.com\thttps://www.linkedin.com/in/alice\nbob@example.com\thttps://www.linkedin.com/in/bob";
    const rows = parseSpreadsheetData(tsv);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].email, "alice@example.com");
    assert.strictEqual(rows[0].linkedin_url, "https://www.linkedin.com/in/alice");
  });

  test("handles tab-separated data without header", () => {
    const tsv = "alice@example.com\thttps://www.linkedin.com/in/alice\nbob@example.com\thttps://www.linkedin.com/in/bob";
    const rows = parseSpreadsheetData(tsv);
    assert.strictEqual(rows.length, 2);
  });

  test("handles Windows-style line endings", () => {
    const csv = "email,linkedin_url\r\nalice@example.com,https://www.linkedin.com/in/alice\r\nbob@example.com,https://www.linkedin.com/in/bob";
    const rows = parseSpreadsheetData(csv);
    assert.strictEqual(rows.length, 2);
  });

  test("skips empty lines in pasted data", () => {
    const tsv = "email\tlinkedin_url\n\nalice@example.com\thttps://www.linkedin.com/in/alice\n\n";
    const rows = parseSpreadsheetData(tsv);
    assert.strictEqual(rows.length, 1);
  });

  test("marks duplicates in pasted data", () => {
    const tsv = "alice@example.com\thttps://www.linkedin.com/in/alice\nalice@example.com\thttps://www.linkedin.com/in/alice2";
    const rows = parseSpreadsheetData(tsv);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].status, "valid");
    assert.strictEqual(rows[1].status, "duplicate");
  });

  test("strips quotes from CSV fields", () => {
    const csv = '"alice@example.com","https://www.linkedin.com/in/alice"';
    const rows = parseSpreadsheetData(csv);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].email, "alice@example.com");
    assert.strictEqual(rows[0].linkedin_url, "https://www.linkedin.com/in/alice");
  });

  test("detects tab delimiter over comma", () => {
    assert.strictEqual(detectDelimiter("email\turl"), "\t");
    assert.strictEqual(detectDelimiter("email,url"), ",");
    assert.strictEqual(detectDelimiter("email\turl,with,commas"), "\t");
  });
});

// ─── Import (non-dry-run) tests ──────────────────────────────────────────────

describe("import execution", () => {
  const ORG_ID = "00000000-0000-0000-0000-000000000001";

  test("updates matching alumni and creates unmatched", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        rows: [
          { email: "alice@example.com", linkedin_url: "https://www.linkedin.com/in/alice" },
          { email: "unknown@example.com", linkedin_url: "https://www.linkedin.com/in/unknown" },
        ],
      },
      alumniRows: [
        { id: "a1", email: "alice@example.com", linkedin_url: null, organization_id: ORG_ID },
      ],
    });

    assert.strictEqual(result.status, 200);
    const body = result.body as unknown as ImportResult;
    assert.strictEqual(body.updated, 1);
    assert.strictEqual(body.created, 1);
    assert.strictEqual(body.preview, undefined);
  });

  test("skips alumni with existing URL when overwrite is false", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        rows: [
          { email: "bob@example.com", linkedin_url: "https://www.linkedin.com/in/bob-new" },
        ],
        overwrite: false,
      },
      alumniRows: [
        { id: "a2", email: "bob@example.com", linkedin_url: "https://www.linkedin.com/in/bob-existing", organization_id: ORG_ID },
      ],
    });

    const body = result.body as unknown as ImportResult;
    assert.strictEqual(body.updated, 0);
    assert.strictEqual(body.skipped, 1);
  });

  test("overwrites alumni URL when overwrite is true", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        rows: [
          { email: "bob@example.com", linkedin_url: "https://www.linkedin.com/in/bob-new" },
        ],
        overwrite: true,
      },
      alumniRows: [
        { id: "a2", email: "bob@example.com", linkedin_url: "https://www.linkedin.com/in/bob-existing", organization_id: ORG_ID },
      ],
    });

    const body = result.body as unknown as ImportResult;
    assert.strictEqual(body.updated, 1);
    assert.strictEqual(body.skipped, 0);
  });
});

// ─── Auth.users fallback lookup tests ───────────────────────────────────────

describe("auth.users email fallback", () => {
  const ORG_ID = "00000000-0000-0000-0000-000000000001";

  test("matches alumni via auth.users when alumni.email is null", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        rows: [
          { email: "dana@example.com", linkedin_url: "https://www.linkedin.com/in/dana" },
        ],
        dryRun: true,
      },
      alumniRows: [
        { id: "a4", email: null, linkedin_url: null, organization_id: ORG_ID, user_id: "auth-user-4" },
      ],
      authUsers: [
        { id: "auth-user-4", email: "dana@example.com" },
      ],
    });

    assert.strictEqual(result.status, 200);
    const body = result.body as unknown as ImportResult;
    assert.strictEqual(body.updated, 1);
    assert.ok(body.preview);
    assert.strictEqual(body.preview["dana@example.com"], "will_update");
  });

  test("direct alumni.email match still works (regression)", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        rows: [
          { email: "alice@example.com", linkedin_url: "https://www.linkedin.com/in/alice" },
        ],
        dryRun: true,
      },
      alumniRows: [
        { id: "a1", email: "alice@example.com", linkedin_url: null, organization_id: ORG_ID },
      ],
      authUsers: [],
    });

    assert.strictEqual(result.status, 200);
    const body = result.body as unknown as ImportResult;
    assert.strictEqual(body.updated, 1);
    assert.ok(body.preview);
    assert.strictEqual(body.preview["alice@example.com"], "will_update");
  });

  test("mixed: some via direct email, some via user_id fallback, some created", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        rows: [
          { email: "alice@example.com", linkedin_url: "https://www.linkedin.com/in/alice" },
          { email: "dana@example.com", linkedin_url: "https://www.linkedin.com/in/dana" },
          { email: "unknown@example.com", linkedin_url: "https://www.linkedin.com/in/unknown" },
        ],
        dryRun: true,
      },
      alumniRows: [
        { id: "a1", email: "alice@example.com", linkedin_url: null, organization_id: ORG_ID },
        { id: "a4", email: null, linkedin_url: null, organization_id: ORG_ID, user_id: "auth-user-4" },
      ],
      authUsers: [
        { id: "auth-user-4", email: "dana@example.com" },
      ],
    });

    assert.strictEqual(result.status, 200);
    const body = result.body as unknown as ImportResult;
    assert.strictEqual(body.updated, 2);
    assert.strictEqual(body.created, 1);
    assert.ok(body.preview);
    assert.strictEqual(body.preview["alice@example.com"], "will_update");
    assert.strictEqual(body.preview["dana@example.com"], "will_update");
    assert.strictEqual(body.preview["unknown@example.com"], "will_create");
  });

  test("auth.users fallback respects will_skip for existing linkedin_url", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        rows: [
          { email: "dana@example.com", linkedin_url: "https://www.linkedin.com/in/dana-new" },
        ],
        dryRun: true,
        overwrite: false,
      },
      alumniRows: [
        { id: "a4", email: null, linkedin_url: "https://www.linkedin.com/in/dana-existing", organization_id: ORG_ID, user_id: "auth-user-4" },
      ],
      authUsers: [
        { id: "auth-user-4", email: "dana@example.com" },
      ],
    });

    assert.strictEqual(result.status, 200);
    const body = result.body as unknown as ImportResult;
    assert.strictEqual(body.skipped, 1);
    assert.strictEqual(body.updated, 0);
    assert.ok(body.preview);
    assert.strictEqual(body.preview["dana@example.com"], "will_skip");
  });

  test("direct email match takes priority over auth.users fallback", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        rows: [
          { email: "alice@example.com", linkedin_url: "https://www.linkedin.com/in/alice" },
        ],
        dryRun: true,
      },
      alumniRows: [
        { id: "a1", email: "alice@example.com", linkedin_url: null, organization_id: ORG_ID },
        { id: "a5", email: null, linkedin_url: null, organization_id: ORG_ID, user_id: "auth-user-5" },
      ],
      authUsers: [
        { id: "auth-user-5", email: "alice@example.com" },
      ],
    });

    assert.strictEqual(result.status, 200);
    const body = result.body as unknown as ImportResult;
    assert.strictEqual(body.updated, 1);
  });
});

// ─── Name derivation tests ──────────────────────────────────────────────────

describe("deriveNameFromEmail", () => {
  test("splits on dot separator", () => {
    const result = deriveNameFromEmail("john.doe@example.com");
    assert.strictEqual(result.first_name, "John");
    assert.strictEqual(result.last_name, "Doe");
  });

  test("splits on underscore separator", () => {
    const result = deriveNameFromEmail("jane_smith@example.com");
    assert.strictEqual(result.first_name, "Jane");
    assert.strictEqual(result.last_name, "Smith");
  });

  test("splits on hyphen separator", () => {
    const result = deriveNameFromEmail("bob-jones@example.com");
    assert.strictEqual(result.first_name, "Bob");
    assert.strictEqual(result.last_name, "Jones");
  });

  test("uses last part as last name for multi-part names", () => {
    const result = deriveNameFromEmail("mary.jane.watson@example.com");
    assert.strictEqual(result.first_name, "Mary");
    assert.strictEqual(result.last_name, "Watson");
  });

  test("handles single-word email prefix", () => {
    const result = deriveNameFromEmail("alice@example.com");
    assert.strictEqual(result.first_name, "Alice");
    assert.strictEqual(result.last_name, "");
  });

  test("handles empty local part", () => {
    const result = deriveNameFromEmail("@example.com");
    assert.strictEqual(result.first_name, "Unknown");
    assert.strictEqual(result.last_name, "");
  });

  test("capitalizes correctly", () => {
    const result = deriveNameFromEmail("JOHN.DOE@example.com");
    assert.strictEqual(result.first_name, "John");
    assert.strictEqual(result.last_name, "Doe");
  });
});

// ─── Alumni creation & quota tests ──────────────────────────────────────────

describe("alumni creation", () => {
  const ORG_ID = "00000000-0000-0000-0000-000000000001";

  test("unmatched email shows will_create in preview (unlimited quota)", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        rows: [
          { email: "newperson@example.com", linkedin_url: "https://www.linkedin.com/in/newperson" },
        ],
        dryRun: true,
      },
      alumniRows: [],
    });

    assert.strictEqual(result.status, 200);
    const body = result.body as unknown as ImportResult;
    assert.strictEqual(body.created, 1);
    assert.strictEqual(body.quotaBlocked, 0);
    assert.ok(body.preview);
    assert.strictEqual(body.preview["newperson@example.com"], "will_create");
  });

  test("quota enforcement: at capacity, unmatched emails show quota_blocked", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        rows: [
          { email: "new1@example.com", linkedin_url: "https://www.linkedin.com/in/new1" },
          { email: "new2@example.com", linkedin_url: "https://www.linkedin.com/in/new2" },
        ],
        dryRun: true,
      },
      alumniRows: [
        { id: "a1", email: "existing@example.com", linkedin_url: null, organization_id: ORG_ID },
      ],
      alumniLimit: 1,
      currentAlumniCount: 1,
    });

    assert.strictEqual(result.status, 200);
    const body = result.body as unknown as ImportResult;
    assert.strictEqual(body.created, 0);
    assert.strictEqual(body.quotaBlocked, 2);
    assert.ok(body.preview);
    assert.strictEqual(body.preview["new1@example.com"], "quota_blocked");
    assert.strictEqual(body.preview["new2@example.com"], "quota_blocked");
  });

  test("quota enforcement: partial capacity creates some, rest quota_blocked", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        rows: [
          { email: "new1@example.com", linkedin_url: "https://www.linkedin.com/in/new1" },
          { email: "new2@example.com", linkedin_url: "https://www.linkedin.com/in/new2" },
          { email: "new3@example.com", linkedin_url: "https://www.linkedin.com/in/new3" },
        ],
        dryRun: true,
      },
      alumniRows: [],
      alumniLimit: 5,
      currentAlumniCount: 3,
    });

    assert.strictEqual(result.status, 200);
    const body = result.body as unknown as ImportResult;
    assert.strictEqual(body.created, 2);
    assert.strictEqual(body.quotaBlocked, 1);
    assert.ok(body.preview);
    assert.strictEqual(body.preview["new1@example.com"], "will_create");
    assert.strictEqual(body.preview["new2@example.com"], "will_create");
    assert.strictEqual(body.preview["new3@example.com"], "quota_blocked");
  });

  test("mixed scenario: update existing + create new + skip over quota", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        rows: [
          { email: "alice@example.com", linkedin_url: "https://www.linkedin.com/in/alice" },
          { email: "bob@example.com", linkedin_url: "https://www.linkedin.com/in/bob-new" },
          { email: "new.person@example.com", linkedin_url: "https://www.linkedin.com/in/newperson" },
          { email: "over.quota@example.com", linkedin_url: "https://www.linkedin.com/in/overquota" },
        ],
        dryRun: true,
      },
      alumniRows: [
        { id: "a1", email: "alice@example.com", linkedin_url: null, organization_id: ORG_ID },
        { id: "a2", email: "bob@example.com", linkedin_url: "https://www.linkedin.com/in/bob-existing", organization_id: ORG_ID },
      ],
      alumniLimit: 3,
      currentAlumniCount: 2,
    });

    assert.strictEqual(result.status, 200);
    const body = result.body as unknown as ImportResult;
    assert.strictEqual(body.updated, 1); // alice (bob skipped)
    assert.strictEqual(body.created, 1); // new.person
    assert.strictEqual(body.skipped, 1); // bob
    assert.strictEqual(body.quotaBlocked, 1); // over.quota
    assert.ok(body.preview);
    assert.strictEqual(body.preview["alice@example.com"], "will_update");
    assert.strictEqual(body.preview["bob@example.com"], "will_skip");
    assert.strictEqual(body.preview["new.person@example.com"], "will_create");
    assert.strictEqual(body.preview["over.quota@example.com"], "quota_blocked");
  });

  test("created alumni count is returned in non-dry-run", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        rows: [
          { email: "alice@example.com", linkedin_url: "https://www.linkedin.com/in/alice" },
          { email: "new.person@example.com", linkedin_url: "https://www.linkedin.com/in/newperson" },
        ],
      },
      alumniRows: [
        { id: "a1", email: "alice@example.com", linkedin_url: null, organization_id: ORG_ID },
      ],
    });

    assert.strictEqual(result.status, 200);
    const body = result.body as unknown as ImportResult;
    assert.strictEqual(body.updated, 1);
    assert.strictEqual(body.created, 1);
    assert.strictEqual(body.preview, undefined);
  });

  test("duplicate unmatched emails create only one alumni record", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        rows: [
          { email: "new.person@example.com", linkedin_url: "https://www.linkedin.com/in/newperson" },
          { email: "NEW.PERSON@example.com", linkedin_url: "https://www.linkedin.com/in/newperson-2" },
        ],
        dryRun: true,
      },
      alumniRows: [],
    });

    assert.strictEqual(result.status, 200);
    const body = result.body as unknown as ImportResult;
    assert.strictEqual(body.created, 1);
    assert.ok(body.preview);
    assert.strictEqual(body.preview["new.person@example.com"], "will_create");
  });

  test("duplicate unmatched emails do not consume quota twice", () => {
    const result = simulateImport({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        rows: [
          { email: "new.person@example.com", linkedin_url: "https://www.linkedin.com/in/newperson" },
          { email: "NEW.PERSON@example.com", linkedin_url: "https://www.linkedin.com/in/newperson-2" },
          { email: "overflow@example.com", linkedin_url: "https://www.linkedin.com/in/overflow" },
        ],
        dryRun: true,
      },
      alumniRows: [],
      alumniLimit: 1,
      currentAlumniCount: 0,
    });

    assert.strictEqual(result.status, 200);
    const body = result.body as unknown as ImportResult;
    assert.strictEqual(body.created, 1);
    assert.strictEqual(body.quotaBlocked, 1);
    assert.ok(body.preview);
    assert.strictEqual(body.preview["new.person@example.com"], "will_create");
    assert.strictEqual(body.preview["overflow@example.com"], "quota_blocked");
  });
});
