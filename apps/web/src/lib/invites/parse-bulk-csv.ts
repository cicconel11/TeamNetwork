/**
 * Parse CSV for bulk enterprise invites
 *
 * CSV format: two columns (role, organizationId) per row
 * - Supports optional header row (detected if first line contains "role")
 * - Both fields optional; form-level defaults are applied at upload time
 * - Filters empty lines; returns parsed rows and truncation status (max 100 rows)
 */

export interface ParsedBulkInviteRow {
  role?: string;
  organizationId?: string;
  error?: string;
}

export interface BulkCSVParseResult {
  rows: ParsedBulkInviteRow[];
  truncated: boolean;
}

export function parseCSV(text: string): BulkCSVParseResult {
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.length === 0) {
    return { rows: [], truncated: false };
  }

  // Check if first line is a header
  const firstLine = lines[0].toLowerCase();
  const hasHeader = firstLine.includes("role");
  const dataLines = hasHeader ? lines.slice(1) : lines;

  // Parse data rows with validation
  const VALID_ROLES = new Set(["admin", "active_member", "alumni"]);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const rows = dataLines.map((line) => {
    const parts = line.split(",").map((p) => p.trim().replace(/^["']|["']$/g, ""));
    const role = parts[0] || undefined;
    const organizationId = parts[1] || undefined;

    const errors: string[] = [];
    if (role && !VALID_ROLES.has(role)) {
      errors.push(`invalid role "${role}"`);
    }
    if (organizationId && !UUID_RE.test(organizationId)) {
      errors.push("organization_id is not a valid UUID");
    }

    return { role, organizationId, error: errors.length ? errors.join("; ") : undefined };
  }).filter((row) => row.role || row.organizationId); // Drop fully blank rows only

  // Apply 100-row limit
  const truncated = rows.length > 100;
  const capped = rows.slice(0, 100);

  return { rows: capped, truncated };
}
