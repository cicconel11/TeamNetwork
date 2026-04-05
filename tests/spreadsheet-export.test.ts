import test from "node:test";
import assert from "node:assert/strict";
import {
  protectSpreadsheetCell,
  escapeCsvCell,
  escapeTsvCell,
} from "@/lib/export/spreadsheet";

test("protectSpreadsheetCell prefixes dangerous formulas", () => {
  assert.equal(protectSpreadsheetCell("=WEBSERVICE(\"https://evil.test\")"), "'=WEBSERVICE(\"https://evil.test\")");
  assert.equal(protectSpreadsheetCell("+SUM(1,2)"), "'+SUM(1,2)");
  assert.equal(protectSpreadsheetCell("-2+3"), "'-2+3");
  assert.equal(protectSpreadsheetCell("@HYPERLINK(\"https://evil.test\")"), "'@HYPERLINK(\"https://evil.test\")");
});

test("protectSpreadsheetCell leaves safe values unchanged", () => {
  assert.equal(protectSpreadsheetCell("Alice"), "Alice");
  assert.equal(protectSpreadsheetCell("alice@example.com"), "alice@example.com");
  assert.equal(protectSpreadsheetCell(""), "");
});

test("escapeCsvCell neutralizes formulas before CSV quoting", () => {
  assert.equal(
    escapeCsvCell("=WEBSERVICE(\"https://evil.test\")"),
    "\"'=WEBSERVICE(\"\"https://evil.test\"\")\""
  );
});

test("escapeCsvCell still escapes commas, quotes, and newlines", () => {
  assert.equal(
    escapeCsvCell("Hello,\n\"world\""),
    "\"Hello,\n\"\"world\"\"\""
  );
});

test("escapeTsvCell neutralizes formulas and removes tabs/newlines", () => {
  assert.equal(
    escapeTsvCell("=CMD()\twith\nbreaks"),
    "'=CMD() with breaks"
  );
});
