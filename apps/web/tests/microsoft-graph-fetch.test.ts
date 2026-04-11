import test from "node:test";
import assert from "node:assert/strict";
import { graphFetch } from "@/lib/microsoft/graph-fetch";

test("graphFetch caps repeated 429 retries", async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  let attempts = 0;

  global.fetch = (async () => {
    attempts++;
    return new Response("Rate limited", {
      status: 429,
      headers: { "Retry-After": "0" },
    });
  }) as typeof fetch;

  global.setTimeout = ((callback: (...args: unknown[]) => void) => {
    callback();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  try {
    await assert.rejects(
      () => graphFetch("/me/events", "token"),
      /429/,
    );
    assert.equal(attempts, 3, "Should stop after the configured retry budget");
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  }
});
