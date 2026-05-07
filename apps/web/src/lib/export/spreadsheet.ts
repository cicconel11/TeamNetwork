const SPREADSHEET_FORMULA_PREFIX = /^[\t\r\n ]*[=+\-@]/;

function toExportString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

export function protectSpreadsheetCell(value: unknown): string {
  const stringValue = toExportString(value);
  if (stringValue === "") {
    return "";
  }

  return SPREADSHEET_FORMULA_PREFIX.test(stringValue)
    ? `'${stringValue}`
    : stringValue;
}

export function escapeCsvCell(value: unknown): string {
  const protectedValue = protectSpreadsheetCell(value);
  if (
    protectedValue.includes(",") ||
    protectedValue.includes('"') ||
    protectedValue.includes("\n")
  ) {
    return `"${protectedValue.replace(/"/g, '""')}"`;
  }

  return protectedValue;
}

export function escapeTsvCell(value: unknown): string {
  return protectSpreadsheetCell(value)
    .replace(/\t/g, " ")
    .replace(/\r?\n/g, " ");
}
