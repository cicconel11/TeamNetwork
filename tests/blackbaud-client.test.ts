import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

describe("BlackbaudClient", () => {
  it("builds correct URL with subscription key header", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const mockFetch = mock.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ count: 0, value: [] }), { status: 200 });
    });

    const { createBlackbaudClient } = await import("../src/lib/blackbaud/client");
    const client = createBlackbaudClient({
      accessToken: "test-token",
      subscriptionKey: "test-sub-key",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await client.get("/constituent/v1/constituents", { limit: "10" });

    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("/constituent/v1/constituents"));
    assert.ok(calls[0].url.includes("limit=10"));

    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers["Authorization"], "Bearer test-token");
    assert.equal(headers["Bb-Api-Subscription-Key"], "test-sub-key");
  });

  it("throws on non-200 responses", async () => {
    const mockFetch = mock.fn(async () => {
      return new Response("Forbidden", { status: 403 });
    });

    const { createBlackbaudClient } = await import("../src/lib/blackbaud/client");
    const client = createBlackbaudClient({
      accessToken: "test-token",
      subscriptionKey: "test-sub-key",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await assert.rejects(
      () => client.get("/constituent/v1/constituents"),
      (err: Error) => err.message.includes("403")
    );
  });

  it("throws BlackbaudApiError with isQuotaExhausted on rate limit (429)", async () => {
    const mockFetch = mock.fn(async () => {
      return new Response("Rate limited", { status: 429 });
    });

    const { createBlackbaudClient, BlackbaudApiError } = await import("../src/lib/blackbaud/client");
    const client = createBlackbaudClient({
      accessToken: "test-token",
      subscriptionKey: "test-sub-key",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await assert.rejects(
      () => client.get("/constituent/v1/constituents"),
      (err: unknown) => {
        assert.ok(err instanceof BlackbaudApiError);
        assert.equal(err.status, 429);
        assert.equal(err.isQuotaExhausted, true);
        return true;
      }
    );
  });

  it("detects quota exhaustion from 403 body text", async () => {
    const mockFetch = mock.fn(async () => {
      return new Response(
        JSON.stringify({ statusCode: 403, message: "Out of call volume quota. Quota will be replenished in 07:30:00." }),
        { status: 403 }
      );
    });

    const { createBlackbaudClient, BlackbaudApiError } = await import("../src/lib/blackbaud/client");
    const client = createBlackbaudClient({
      accessToken: "test-token",
      subscriptionKey: "test-sub-key",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await assert.rejects(
      () => client.get("/constituent/v1/constituents"),
      (err: unknown) => {
        assert.ok(err instanceof BlackbaudApiError);
        assert.equal(err.status, 403);
        assert.equal(err.isQuotaExhausted, true);
        assert.equal(err.retryAfterHuman, "07:30:00");
        return true;
      }
    );
  });
});
