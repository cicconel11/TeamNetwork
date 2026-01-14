import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function getLatestPolicySql(policyName: string): string {
  const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
  const files = fs.readdirSync(migrationsDir).sort();
  let latestPolicy = "";

  const marker = `CREATE POLICY ${policyName} ON public.`;
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const index = sql.indexOf(marker);
    if (index === -1) continue;
    const rest = sql.slice(index);
    const end = rest.indexOf(";");
    latestPolicy = end >= 0 ? rest.slice(0, end + 1) : rest;
  }

  return latestPolicy;
}

test("chat poll/form routes enforce explicit group membership for creation", () => {
  const pollsRoute = read("src/app/api/chat/[groupId]/polls/route.ts");
  const formsRoute = read("src/app/api/chat/[groupId]/forms/route.ts");

  assert.match(pollsRoute, /if\s*\(!ctx\.membership\)\s*\{\s*return respond\(\{ error: "Forbidden" \}, 403\);/);
  assert.match(formsRoute, /if\s*\(!ctx\.membership\)\s*\{\s*return respond\(\{ error: "Forbidden" \}, 403\);/);
});

test("chat vote/response routes validate UUID params and hard-limit body size", () => {
  const votesRoute = read("src/app/api/chat/[groupId]/polls/[messageId]/votes/route.ts");
  const responsesRoute = read("src/app/api/chat/[groupId]/forms/[messageId]/responses/route.ts");

  assert.match(votesRoute, /baseSchemas\.uuid\.safeParse\(groupId\)/);
  assert.match(votesRoute, /baseSchemas\.uuid\.safeParse\(messageId\)/);
  assert.match(responsesRoute, /baseSchemas\.uuid\.safeParse\(groupId\)/);
  assert.match(responsesRoute, /baseSchemas\.uuid\.safeParse\(messageId\)/);
  assert.match(responsesRoute, /req\.arrayBuffer\(\)/);
  assert.match(responsesRoute, /bodyBuffer\.byteLength > 25_000/);
});

test("latest chat RLS policies include parent role access", () => {
  const membersSelect = getLatestPolicySql("chat_group_members_select");
  const messagesSelect = getLatestPolicySql("chat_messages_select");
  const messagesInsert = getLatestPolicySql("chat_messages_insert");
  const pollVotesInsert = getLatestPolicySql("chat_poll_votes_insert");
  const formResponsesInsert = getLatestPolicySql("chat_form_responses_insert");

  assert.match(membersSelect, /'parent'/i);
  assert.match(messagesSelect, /'parent'/i);
  assert.match(messagesInsert, /'parent'/i);
  assert.match(pollVotesInsert, /'parent'/i);
  assert.match(formResponsesInsert, /'parent'/i);
});
