import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("chat message like route validates group and message ids", () => {
  const route = read("src/app/api/chat/[groupId]/messages/[messageId]/like/route.ts");

  assert.match(route, /baseSchemas\.uuid\.safeParse\(groupId\)/);
  assert.match(route, /baseSchemas\.uuid\.safeParse\(messageId\)/);
  assert.match(route, /\.from\("chat_message_likes"\)/);
});
