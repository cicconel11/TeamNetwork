import { strict as assert } from "assert";
import { test } from "node:test";
import { parseCSV } from "@/lib/invites/parse-bulk-csv";

const ORG_1 = "00000000-0000-4000-a000-000000000001";
const ORG_2 = "00000000-0000-4000-a000-000000000002";
const ORG_3 = "00000000-0000-4000-a000-000000000003";

test("CSV parser — basic 2-column format", () => {
  const csv = `admin,${ORG_1}
active_member,${ORG_2}
alumni,${ORG_3}`;
  const result = parseCSV(csv);
  assert.equal(result.rows.length, 3);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.rows[0], { role: "admin", organizationId: ORG_1, error: undefined });
});

test("CSV parser — with header row", () => {
  const csv = `role,organizationId
admin,${ORG_1}
active_member,${ORG_2}`;
  const result = parseCSV(csv);
  assert.equal(result.rows.length, 2);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.rows[0], { role: "admin", organizationId: ORG_1, error: undefined });
});

test("CSV parser — Windows CRLF line endings", () => {
  const csv = `admin,${ORG_1}\r\nactive_member,${ORG_2}\r\n`;
  const result = parseCSV(csv);
  assert.equal(result.rows.length, 2);
  assert.equal(result.truncated, false);
});

test("CSV parser — quoted fields", () => {
  const csv = `"admin","${ORG_1}"
'alumni','${ORG_2}'`;
  const result = parseCSV(csv);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], { role: "admin", organizationId: ORG_1, error: undefined });
  assert.deepEqual(result.rows[1], { role: "alumni", organizationId: ORG_2, error: undefined });
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
  const csv = `admin,${ORG_1}
active_member
,${ORG_2}
alumni,${ORG_3}`;
  const result = parseCSV(csv);
  assert.equal(result.rows.length, 4);
  assert.deepEqual(result.rows[0], { role: "admin", organizationId: ORG_1, error: undefined });
  assert.deepEqual(result.rows[1], { role: "active_member", organizationId: undefined, error: undefined });
  assert.deepEqual(result.rows[2], { role: undefined, organizationId: ORG_2, error: undefined });
  assert.deepEqual(result.rows[3], { role: "alumni", organizationId: ORG_3, error: undefined });
});

test("CSV parser — rejects non-UUID organization IDs", () => {
  const csv = `admin,org-123`;
  const result = parseCSV(csv);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.error, "organization_id is not a valid UUID");
});

test("CSV parser — 100-row limit with truncation flag", () => {
  const uuid = ORG_1;
  const rows = Array.from({ length: 105 }, () => `admin,${uuid}`).join("\n");
  const result = parseCSV(rows);
  assert.equal(result.rows.length, 100);
  assert.equal(result.truncated, true);
});

test("CSV parser — exactly 100 rows", () => {
  const uuid = ORG_1;
  const rows = Array.from({ length: 100 }, () => `admin,${uuid}`).join("\n");
  const result = parseCSV(rows);
  assert.equal(result.rows.length, 100);
  assert.equal(result.truncated, false);
});

test("CSV parser — blank lines are filtered", () => {
  const csv = `admin,${ORG_1}

active_member,${ORG_2}

alumni,${ORG_3}`;
  const result = parseCSV(csv);
  assert.equal(result.rows.length, 3);
  assert.equal(result.truncated, false);
});
