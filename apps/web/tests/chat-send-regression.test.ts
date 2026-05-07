import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function getLatestChatMessagesInsertPolicySql(): string {
  const migrationsDir = path.join(REPO_ROOT, "supabase", "migrations");
  const files = fs.readdirSync(migrationsDir).sort();
  let latestPolicy = "";

  for (const file of files) {
    const fullPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(fullPath, "utf8");
    const marker = "CREATE POLICY chat_messages_insert ON public.chat_messages";
    const index = sql.indexOf(marker);
    if (index === -1) continue;

    const rest = sql.slice(index);
    const end = rest.indexOf(";");
    latestPolicy = end >= 0 ? rest.slice(0, end + 1) : rest;
  }

  return latestPolicy;
}

test("chat room sends text messages through API (not direct client insert)", () => {
  const source = readFile("src/components/messages/ChatMessagePane.tsx");

  assert.match(
    source,
    /fetch\(`\/api\/chat\/\$\{group\.id\}\/messages`\s*,/,
    "ChatRoom should post text messages through /api/chat/[groupId]/messages",
  );

  assert.doesNotMatch(
    source,
    /\.from\("chat_messages"\)\s*\.insert\(/,
    "Client-side direct inserts to chat_messages should not be used for sending text messages",
  );
});

test("latest chat_messages_insert policy allows org admins OR group members", () => {
  const policySql = getLatestChatMessagesInsertPolicySql();
  assert.ok(policySql.length > 0, "chat_messages_insert policy should exist in migrations");

  assert.match(
    policySql,
    /has_active_role\(organization_id,\s*array\['admin'\]\)/i,
    "chat_messages_insert should allow org admins to send without explicit group membership",
  );

  assert.match(
    policySql,
    /is_chat_group_member\(chat_group_id\)/i,
    "chat_messages_insert should still allow regular group members",
  );
});
