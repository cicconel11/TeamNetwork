import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatActivityLeaderboard,
  loadActivityLeaderboard,
} from "../src/lib/ai/smoke-helpers.ts";

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

describe("loadActivityLeaderboard", () => {
  it("builds a leaderboard from cross-surface activity data", async () => {
    const tables: Record<string, unknown[]> = {
      feed_posts: [{ author_id: "user-1" }, { author_id: "user-1" }],
      feed_comments: [{ author_id: "user-2" }],
      chat_messages: [{ author_id: "user-1" }, { author_id: "user-2" }, { author_id: "user-2" }],
      discussion_threads: [{ author_id: "user-1" }],
      discussion_replies: [{ author_id: "user-2" }],
      users: [
        { id: "user-1", name: "Taylor Captain", email: "taylor@example.com" },
        { id: "user-2", name: "Jordan Member", email: "jordan@example.com" },
      ],
    };

    const mockSupabase = {
      from(table: string) {
        const chain: Record<string, unknown> = {};
        let ids: string[] | null = null;

        chain.select = () => chain;
        chain.eq = () => chain;
        chain.is = () => chain;
        chain.in = (_column: string, value: string[]) => {
          ids = value;
          return chain;
        };
        chain.then = (resolve: (value: unknown) => void) => {
          const data = table === "users" && ids
            ? (tables[table] as Array<{ id: string }>).filter((user) => ids!.includes(user.id))
            : tables[table] ?? [];
          resolve({ data, error: null });
        };

        return chain;
      },
    };

    const output = await loadActivityLeaderboard(mockSupabase as never, "org-1");

    assert.ok(output);
    assert.match(output!, /Taylor Captain - 4 total actions/);
    assert.match(output!, /Jordan Member - 4 total actions/);
  });
});
