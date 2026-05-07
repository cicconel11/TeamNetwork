import assert from "node:assert/strict";
import test from "node:test";
import { requestJson, ApiMutationError } from "../src/lib/client/request-json";

test("requestJson returns parsed JSON for successful responses", async () => {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const fetchImpl = async (input: string, init?: RequestInit) => {
    calls.push([input, init]);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await requestJson<{ ok: boolean }>("/api/example", {
    method: "POST",
    body: { name: "Team" },
    fetchImpl,
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/api/example");
  assert.equal(calls[0][1]?.method, "POST");
  assert.equal(new Headers(calls[0][1]?.headers).get("Content-Type"), "application/json");
  assert.equal(calls[0][1]?.body, JSON.stringify({ name: "Team" }));
});

test("requestJson throws a useful ApiMutationError from error response bodies", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ error: "Validation failed", details: ["name: required"] }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });

  await assert.rejects(
    requestJson("/api/example", { fetchImpl }),
    (error) => {
      assert.ok(error instanceof ApiMutationError);
      assert.equal(error.status, 400);
      assert.equal(error.message, "Validation failed");
      assert.deepEqual(error.details, ["name: required"]);
      return true;
    },
  );
});
