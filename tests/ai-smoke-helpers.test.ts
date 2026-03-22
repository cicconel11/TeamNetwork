import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatActivityLeaderboard } from "../src/lib/ai/smoke-helpers.ts";

describe("formatActivityLeaderboard", () => {
  it("formats the top active users with a readable breakdown", () => {
    const output = formatActivityLeaderboard([
      {
        name: "Louis Ciccone",
        email: "lociccone11@gmail.com",
        feed_posts: 0,
        feed_comments: 2,
        chat_messages: 4,
        discussion_threads: 3,
        discussion_replies: 4,
        total_activity: 13,
      },
      {
        name: null,
        email: "fallback@example.com",
        feed_posts: 1,
        feed_comments: 0,
        chat_messages: 0,
        discussion_threads: 0,
        discussion_replies: 0,
        total_activity: 1,
      },
    ]);

    assert.ok(output);
    assert.match(output!, /## Most Active Users/);
    assert.match(output!, /Louis Ciccone - 13 total actions/);
    assert.match(output!, /2 feed comments, 4 chat messages, 3 discussion threads, 4 discussion replies/);
    assert.match(output!, /fallback@example.com - 1 total actions \(1 feed posts\)/);
  });

  it("returns null when there is no activity to report", () => {
    const output = formatActivityLeaderboard([
      {
        name: "Quiet User",
        email: "quiet@example.com",
        feed_posts: 0,
        feed_comments: 0,
        chat_messages: 0,
        discussion_threads: 0,
        discussion_replies: 0,
        total_activity: 0,
      },
    ]);

    assert.equal(output, null);
  });
});
