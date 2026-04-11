import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("checkBlackbaudHealth", () => {
  it("returns { ok: true } on 200 response", async () => {
    const { createBlackbaudClient } = await import("../src/lib/blackbaud/client.ts");
    const { checkBlackbaudHealth } = await import("../src/lib/blackbaud/health.ts");

    const client = createBlackbaudClient({
      accessToken: "test-token",
      subscriptionKey: "test-key",
      fetchFn: async () =>
        new Response(JSON.stringify({ count: 0, value: [] }), { status: 200 }),
    });

    const result = await checkBlackbaudHealth(client);

    assert.deepEqual(result, { ok: true });
  });

  it("returns { ok: false, reason: 'unauthorized' } on 401 response", async () => {
    const { createBlackbaudClient } = await import("../src/lib/blackbaud/client.ts");
    const { checkBlackbaudHealth } = await import("../src/lib/blackbaud/health.ts");

    const client = createBlackbaudClient({
      accessToken: "bad-token",
      subscriptionKey: "test-key",
      fetchFn: async () => new Response("Unauthorized", { status: 401 }),
    });

    const result = await checkBlackbaudHealth(client);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "unauthorized");
  });

  it("returns { ok: false, reason: 'forbidden' } on 403 response", async () => {
    const { createBlackbaudClient } = await import("../src/lib/blackbaud/client.ts");
    const { checkBlackbaudHealth } = await import("../src/lib/blackbaud/health.ts");

    const client = createBlackbaudClient({
      accessToken: "test-token",
      subscriptionKey: "bad-key",
      fetchFn: async () => new Response("Forbidden", { status: 403 }),
    });

    const result = await checkBlackbaudHealth(client);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "forbidden");
  });

  it("returns { ok: false, reason: 'network_error' } when fetch throws", async () => {
    const { createBlackbaudClient } = await import("../src/lib/blackbaud/client.ts");
    const { checkBlackbaudHealth } = await import("../src/lib/blackbaud/health.ts");

    const client = createBlackbaudClient({
      accessToken: "test-token",
      subscriptionKey: "test-key",
      fetchFn: async () => {
        throw new Error("Network error: ECONNREFUSED");
      },
    });

    const result = await checkBlackbaudHealth(client);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "network_error");
  });
});
