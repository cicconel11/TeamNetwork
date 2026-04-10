import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("discussion reply like route scopes likes to thread replies", () => {
  const route = read("src/app/api/discussions/[threadId]/replies/[replyId]/like/route.ts");

  assert.match(route, /baseSchemas\.uuid\.safeParse\(threadId\)/);
  assert.match(route, /baseSchemas\.uuid\.safeParse\(replyId\)/);
  assert.match(route, /\.eq\("id", replyId\)/);
  assert.match(route, /\.eq\("thread_id", threadId\)/);
  assert.match(route, /\.from\("discussion_reply_likes"\)/);
});
