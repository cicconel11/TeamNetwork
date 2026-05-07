import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { createApiRoute, parseSearchParams } from "../src/lib/api/route";

test("createApiRoute validates JSON bodies and returns standardized validation errors", async () => {
  const handler = createApiRoute({
    body: z.object({ name: z.string().min(1) }),
    handler: async ({ body }) => Response.json({ name: body.name }),
  });

  const response = await handler(new Request("https://example.test/api", {
    method: "POST",
    body: JSON.stringify({ name: "" }),
    headers: { "content-type": "application/json" },
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Validation error",
    message: "Invalid request body",
    code: "VALIDATION_ERROR",
    details: ["name: Too small: expected string to have >=1 characters"],
  });
});

test("createApiRoute validates query strings before calling the handler", async () => {
  let called = false;
  const handler = createApiRoute({
    query: z.object({ orgId: z.string().uuid() }),
    handler: async ({ query }) => {
      called = true;
      return Response.json({ orgId: query.orgId });
    },
  });

  const response = await handler(new Request("https://example.test/api?orgId=not-a-uuid"));

  assert.equal(called, false);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "VALIDATION_ERROR");
  assert.equal(body.message, "Invalid query parameters");
});

test("createApiRoute can return an early response before body parsing", async () => {
  let called = false;
  const handler = createApiRoute({
    body: z.object({ name: z.string() }),
    before: async () => Response.json({ error: "Rate limited" }, { status: 429 }),
    handler: async () => {
      called = true;
      return Response.json({ ok: true });
    },
  });

  const response = await handler(new Request("https://example.test/api", { method: "POST", body: "not-json" }));

  assert.equal(called, false);
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: "Rate limited" });
});

test("createApiRoute runs auth policy and merges headers", async () => {
  const handler = createApiRoute({
    headers: { "Cache-Control": "no-store" },
    auth: async () => ({ ok: true, user: { id: "user_1" } }),
    handler: async ({ auth }) => Response.json({ userId: auth.user.id }, { headers: { "X-Feature": "demo" } }),
  });

  const response = await handler(new Request("https://example.test/api"));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Feature"), "demo");
  assert.deepEqual(await response.json(), { userId: "user_1" });
});

test("createApiRoute exposes validation failures to route-specific side effects", async () => {
  const failures: string[] = [];
  const handler = createApiRoute({
    body: z.object({ name: z.string().min(1) }),
    onValidationError: async ({ source }) => {
      failures.push(source);
    },
    handler: async () => Response.json({ ok: true }),
  });

  const response = await handler(new Request("https://example.test/api", {
    method: "POST",
    body: JSON.stringify({ name: "" }),
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(failures, ["body"]);
});

test("parseSearchParams preserves repeated keys as arrays", () => {
  const parsed = parseSearchParams(new URL("https://example.test/api?tag=a&tag=b&name=x").searchParams);

  assert.deepEqual(parsed, { tag: ["a", "b"], name: "x" });
});
