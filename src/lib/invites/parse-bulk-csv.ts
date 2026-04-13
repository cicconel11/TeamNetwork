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

  // Parse data rows
  const rows = dataLines.map((line) => {
    const parts = line.split(",").map((p) => p.trim().replace(/^["']|["']$/g, ""));
    return {
      role: parts[0] || undefined,
      organizationId: parts[1] || undefined,
    };
  }).filter((row) => row.role || row.organizationId); // At least one field required

  // Apply 100-row limit
  const truncated = rows.length > 100;
  const capped = rows.slice(0, 100);

  return { rows: capped, truncated };
}
