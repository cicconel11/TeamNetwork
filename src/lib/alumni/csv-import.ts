export interface CsvImportRow {
  first_name: string;
  last_name: string;
  email?: string | null;
  graduation_year?: number | null;
  major?: string | null;
  job_title?: string | null;
  notes?: string | null;
  linkedin_url?: string | null;
  phone_number?: string | null;
  industry?: string | null;
  current_company?: string | null;
  current_city?: string | null;
  position_title?: string | null;
}

export type CsvImportPreviewStatus =
  | "will_create"
  | "will_update"
  | "will_skip"
  | "quota_blocked"
  | "duplicate"
  | "invalid";

export interface CsvImportPreviewRow extends CsvImportRow {
  status: CsvImportPreviewStatus;
  rowIndex: number;
}

export interface NormalizeCsvImportRowsResult {
  rows: CsvImportRow[];
  duplicateIndices: Map<number, number>; // duplicate rowIndex -> first occurrence rowIndex
}

export function normalizeCsvImportRows(rows: CsvImportRow[]): NormalizeCsvImportRowsResult {
  const seenEmails = new Map<string, number>(); // email -> first rowIndex
  const deduped: CsvImportRow[] = [];
  const duplicateIndices = new Map<number, number>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.email) {
      // Email-less rows are never deduped
      deduped.push(row);
      continue;
    }

    const emailKey = row.email.toLowerCase();
    const firstIndex = seenEmails.get(emailKey);

    if (firstIndex !== undefined) {
      duplicateIndices.set(i, firstIndex);
      continue;
    }

    seenEmails.set(emailKey, i);
    deduped.push({ ...row, email: emailKey });
  }

  return { rows: deduped, duplicateIndices };
}

export interface PlanCsvImportResult {
  toCreate: CsvImportRow[];
  toUpdate: { alumniId: string; data: Partial<CsvImportRow> }[];
  preview: CsvImportPreviewRow[];
  skipped: number;
  quotaBlocked: number;
}

/** Build an update payload containing only non-null fields from the CSV row. */
export function buildUpdateData(row: CsvImportRow): Partial<CsvImportRow> {
  const data: Partial<CsvImportRow> = {};
  if (row.first_name) data.first_name = row.first_name;
  if (row.last_name) data.last_name = row.last_name;
  if (row.email) data.email = row.email;
  if (row.graduation_year != null) data.graduation_year = row.graduation_year;
  if (row.major) data.major = row.major;
  if (row.job_title) data.job_title = row.job_title;
  if (row.notes) data.notes = row.notes;
  if (row.linkedin_url) data.linkedin_url = row.linkedin_url;
  if (row.phone_number) data.phone_number = row.phone_number;
  if (row.industry) data.industry = row.industry;
  if (row.current_company) data.current_company = row.current_company;
  if (row.current_city) data.current_city = row.current_city;
  if (row.position_title) data.position_title = row.position_title;
  return data;
}

export function planCsvImport(params: {
  rows: CsvImportRow[];
  overwrite: boolean;
  alumniByEmail: Map<string, { id: string; hasData: boolean }>;
  remainingCapacity: number;
}): PlanCsvImportResult {
  const { overwrite, alumniByEmail, remainingCapacity } = params;
  const { rows, duplicateIndices } = normalizeCsvImportRows(params.rows);

  const toCreate: CsvImportRow[] = [];
  const toUpdate: { alumniId: string; data: Partial<CsvImportRow> }[] = [];
  const preview: CsvImportPreviewRow[] = [];
  let skipped = 0;
  let quotaBlocked = 0;
  let createCount = 0;

  // Build a map from deduped row back to original index
  // After normalization, rows array has deduped rows; we track original indices separately
  let originalRowIndex = 0;
  let dedupedRowIndex = 0;

  for (let i = 0; i < params.rows.length; i++) {
    // Check if this original row was a duplicate
    if (duplicateIndices.has(i)) {
      const firstIndex = duplicateIndices.get(i)!;
      preview.push({
        ...params.rows[i],
        status: "duplicate",
        rowIndex: i,
      });
      continue;
    }

    const row = rows[dedupedRowIndex];
    dedupedRowIndex++;

    const emailKey = row.email ? row.email.toLowerCase() : null;
    const match = emailKey ? alumniByEmail.get(emailKey) : null;

    if (!match) {
      if (createCount < remainingCapacity) {
        toCreate.push(row);
        createCount++;
        preview.push({ ...row, status: "will_create", rowIndex: i });
      } else {
        quotaBlocked++;
        preview.push({ ...row, status: "quota_blocked", rowIndex: i });
      }
      continue;
    }

    if (match.hasData && !overwrite) {
      skipped++;
      preview.push({ ...row, status: "will_skip", rowIndex: i });
      continue;
    }

    toUpdate.push({ alumniId: match.id, data: buildUpdateData(row) });
    preview.push({ ...row, status: "will_update", rowIndex: i });
  }

  return { toCreate, toUpdate, preview, skipped, quotaBlocked };
}

const FIELD_MAP: Record<string, keyof CsvImportRow> = {
  // first_name
  "first_name": "first_name",
  "first name": "first_name",
  "firstname": "first_name",
  // last_name
  "last_name": "last_name",
  "last name": "last_name",
  "lastname": "last_name",
  // email
  "email": "email",
  "email address": "email",
  // graduation_year
  "graduation_year": "graduation_year",
  "graduation year": "graduation_year",
  "class year": "graduation_year",
  "grad_year": "graduation_year",
  "grad year": "graduation_year",
  // major
  "major": "major",
  // job_title
  "job_title": "job_title",
  "job title": "job_title",
  "jobtitle": "job_title",
  // notes
  "notes": "notes",
  // linkedin_url
  "linkedin_url": "linkedin_url",
  "linkedin url": "linkedin_url",
  "linkedin": "linkedin_url",
  // phone_number
  "phone_number": "phone_number",
  "phone number": "phone_number",
  "phone": "phone_number",
  // industry
  "industry": "industry",
  // current_company
  "current_company": "current_company",
  "current company": "current_company",
  "company": "current_company",
  // current_city
  "current_city": "current_city",
  "current city": "current_city",
  "city": "current_city",
  // position_title
  "position_title": "position_title",
  "position title": "position_title",
  "position": "position_title",
  "title": "position_title",
};

function normalizeHeaderKey(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeStringValue(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * State-machine RFC 4180 parser. Handles quoted fields with embedded newlines,
 * commas, and escaped quotes. Returns an array of records (each record is an
 * array of field strings).
 */
function parseRfc4180(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let pos = 0;
  const len = text.length;

  while (pos < len) {
    const fields: string[] = [];

    // Parse one record (may span multiple lines due to quoted newlines)
    while (true) {
      if (pos >= len) {
        // Trailing delimiter produced an empty final field
        fields.push("");
        break;
      }

      if (text[pos] === '"') {
        // Quoted field — may contain newlines, delimiters, escaped quotes
        pos++; // skip opening quote
        let value = "";
        while (pos < len) {
          if (text[pos] === '"') {
            if (pos + 1 < len && text[pos + 1] === '"') {
              value += '"';
              pos += 2;
            } else {
              pos++; // skip closing quote
              break;
            }
          } else {
            value += text[pos];
            pos++;
          }
        }
        fields.push(value);
      } else {
        // Unquoted field — read until delimiter, newline, or end
        const start = pos;
        while (pos < len && text[pos] !== delimiter && text[pos] !== "\r" && text[pos] !== "\n") {
          pos++;
        }
        fields.push(text.slice(start, pos));
      }

      // After field: delimiter continues the record, newline/EOF ends it
      if (pos < len && text[pos] === delimiter) {
        pos++; // skip delimiter, continue to next field
      } else {
        break;
      }
    }

    // Skip past record-terminating newline(s)
    if (pos < len && text[pos] === "\r") pos++;
    if (pos < len && text[pos] === "\n") pos++;

    records.push(fields);
  }

  return records;
}

function detectDelimiter(headerLine: string): string {
  // Only check up to the first newline for delimiter detection
  const firstLine = headerLine.split(/\r?\n/)[0] ?? headerLine;
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  return tabCount > commaCount ? "\t" : ",";
}

export function parseCsvData(text: string): CsvImportRow[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const delimiter = detectDelimiter(trimmed);
  const records = parseRfc4180(trimmed, delimiter);
  if (records.length < 2) return [];

  const rawHeaders = records[0];
  // Map column index -> CsvImportRow field
  const columnFields: (keyof CsvImportRow | null)[] = rawHeaders.map((h) => {
    const key = normalizeHeaderKey(h);
    return FIELD_MAP[key] ?? null;
  });

  const rows: CsvImportRow[] = [];

  for (let i = 1; i < records.length; i++) {
    const values = records[i];
    // Skip empty records (all fields blank)
    if (values.every((v) => v.trim() === "")) continue;

    const raw: Record<string, string | null> = {};

    for (let j = 0; j < columnFields.length; j++) {
      const field = columnFields[j];
      if (field === null) continue;
      const cellValue = values[j] ?? "";
      raw[field] = normalizeStringValue(cellValue);
    }

    const firstName = raw["first_name"] ?? null;
    const lastName = raw["last_name"] ?? null;

    if (!firstName || !lastName) continue; // required fields

    const row: CsvImportRow = {
      first_name: firstName,
      last_name: lastName,
      email: raw["email"] ?? null,
      graduation_year: raw["graduation_year"] ? (Number.isNaN(Number(raw["graduation_year"])) ? null : Number(raw["graduation_year"])) : null,
      major: raw["major"] ?? null,
      job_title: raw["job_title"] ?? null,
      notes: raw["notes"] ?? null,
      linkedin_url: raw["linkedin_url"] ?? null,
      phone_number: raw["phone_number"] ?? null,
      industry: raw["industry"] ?? null,
      current_company: raw["current_company"] ?? null,
      current_city: raw["current_city"] ?? null,
      position_title: raw["position_title"] ?? null,
    };

    rows.push(row);
  }

  return rows;
}

export function generateCsvTemplate(): string {
  const headers = [
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

  const exampleRow = [
    "Jane",
    "Smith",
    "jane.smith@example.com",
    "2015",
    "Computer Science",
    "Software Engineer",
    "",
    "https://linkedin.com/in/janesmith",
    "+1-555-555-0100",
    "Technology",
    "Acme Corp",
    "San Francisco",
    "Senior Engineer",
  ];

  return [headers.join(","), exampleRow.join(",")].join("\r\n");
}
