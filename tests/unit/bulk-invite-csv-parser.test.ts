import { strict as assert } from "assert";
import { test } from "node:test";
import { parseCSV } from "@/lib/invites/parse-bulk-csv";

test("CSV parser — basic 2-column format", () => {
  const csv = `admin,org-123
active_member,org-456
alumni,org-789`;
  const result = parseCSV(csv);
  assert.equal(result.rows.length, 3);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.rows[0], { role: "admin", organizationId: "org-123" });
});

test("CSV parser — with header row", () => {
  const csv = `role,organizationId
admin,org-123
active_member,org-456`;
  const result = parseCSV(csv);
  assert.equal(result.rows.length, 2);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.rows[0], { role: "admin", organizationId: "org-123" });
});

test("CSV parser — Windows CRLF line endings", () => {
  const csv = `admin,org-123\r\nactive_member,org-456\r\n`;
  const result = parseCSV(csv);
  assert.equal(result.rows.length, 2);
  assert.equal(result.truncated, false);
});

test("CSV parser — quoted fields", () => {
  const csv = `"admin","org-123"
'alumni','org-456'`;
  const result = parseCSV(csv);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], { role: "admin", organizationId: "org-123" });
  assert.deepEqual(result.rows[1], { role: "alumni", organizationId: "org-456" });
});

test("CSV parser — empty file", () => {
  const result = parseCSV("");
  assert.equal(result.rows.length, 0);
  assert.equal(result.truncated, false);
});

test("CSV parser — header-only file", () => {
  const result = parseCSV("role,organizationId");
  assert.equal(result.rows.length, 0);
  assert.equal(result.truncated, false);
});

test("CSV parser — accepts rows with at least one field (form defaults fill the rest)", () => {
  const csv = `admin,org-123
active_member
,org-456
alumni,org-789`;
  const result = parseCSV(csv);
  assert.equal(result.rows.length, 4);
  assert.deepEqual(result.rows[0], { role: "admin", organizationId: "org-123" });
  assert.deepEqual(result.rows[1], { role: "active_member", organizationId: undefined });
  assert.deepEqual(result.rows[2], { role: undefined, organizationId: "org-456" });
  assert.deepEqual(result.rows[3], { role: "alumni", organizationId: "org-789" });
});

test("CSV parser — 100-row limit with truncation flag", () => {
  const rows = Array.from({ length: 105 }, (_, i) => `admin,org-${i}`).join("\n");
  const result = parseCSV(rows);
  assert.equal(result.rows.length, 100);
  assert.equal(result.truncated, true);
});

test("CSV parser — exactly 100 rows", () => {
  const rows = Array.from({ length: 100 }, (_, i) => `admin,org-${i}`).join("\n");
  const result = parseCSV(rows);
  assert.equal(result.rows.length, 100);
  assert.equal(result.truncated, false);
});

test("CSV parser — blank lines are filtered", () => {
  const csv = `admin,org-123

active_member,org-456

alumni,org-789`;
  const result = parseCSV(csv);
  assert.equal(result.rows.length, 3);
  assert.equal(result.truncated, false);
});
