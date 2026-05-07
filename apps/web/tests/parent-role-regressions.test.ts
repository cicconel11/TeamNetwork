import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function getLatestPolicySql(policyName: string): string {
  const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
  const files = fs.readdirSync(migrationsDir).sort();
  let latestPolicy = "";

  const pattern = new RegExp(
    `create policy\\s+${policyName}\\s+on\\s+public\\.[\\s\\S]*?;`,
    "i"
  );
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const match = sql.match(pattern);
    if (!match) continue;
    latestPolicy = match[0];
  }

  return latestPolicy;
}

function getLatestParentInviteCodeDefaultSql(): string {
  const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
  const files = fs.readdirSync(migrationsDir).sort();
  let latestDefault = "";

  const pattern = /ALTER TABLE public\.parent_invites[\s\S]*?ALTER COLUMN code\s+SET DEFAULT\s+([\s\S]*?);/i;
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const match = sql.match(pattern);
    if (!match) continue;
    latestDefault = match[1].trim();
  }

  return latestDefault;
}

function legacyParentInviteCode(base64Encoded: string): string {
  return base64Encoded
    .replaceAll("/", "")
    .replaceAll("+", "")
    .replaceAll("=", "")
    .slice(0, 8)
    .toUpperCase();
}

test("legacy parent invite code sanitization can shrink below 8 characters", () => {
  assert.equal(legacyParentInviteCode("ABCDEF+/"), "ABCDEF");
  assert.ok(legacyParentInviteCode("ABCDEF+/").length < 8);
});

test("latest event RSVP write policies include parent role while remaining self-service", () => {
  const insertPolicy = getLatestPolicySql("event_rsvps_insert");
  const updatePolicy = getLatestPolicySql("event_rsvps_update");

  assert.match(insertPolicy, /'parent'/i);
  assert.match(insertPolicy, /auth\.uid\(\)\s*=\s*user_id|\(select auth\.uid\(\)\)\s*=\s*user_id/i);
  assert.match(updatePolicy, /'parent'/i);
  assert.match(updatePolicy, /auth\.uid\(\)\s*=\s*user_id|\(select auth\.uid\(\)\)\s*=\s*user_id/i);
});

test("latest parent invite code default uses a fixed-length alphabet-safe generator", () => {
  const defaultSql = getLatestParentInviteCodeDefaultSql();

  assert.match(defaultSql, /encode\(gen_random_bytes\(4\), 'hex'\)/i);
  assert.doesNotMatch(defaultSql, /replace\s*\(\s*replace\s*\(\s*replace/i);
});
