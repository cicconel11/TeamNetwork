import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../supabase/migrations/20261018100000_admin_propose_pair_rpc.sql", import.meta.url),
  "utf8"
);

test("admin_propose_pair is not executable by authenticated clients", () => {
  assert.match(
    sql,
    /grant execute on function public\.admin_propose_pair\(uuid, uuid, uuid, numeric, jsonb, uuid\) to service_role;/i
  );
  assert.doesNotMatch(sql, /to authenticated, service_role;/i);
});

test("admin_propose_pair only allows active_member mentee self-service", () => {
  assert.match(sql, /role = 'active_member'/i);
  assert.doesNotMatch(sql, /role in \('active_member','alumni'\)/i);
});

test("admin_propose_pair handles concurrent inserts by catching unique_violation", () => {
  assert.match(sql, /when unique_violation then/i);
  assert.match(sql, /return query select v_existing\.id,/i);
});
