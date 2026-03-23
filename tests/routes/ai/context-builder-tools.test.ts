import test from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "../../../src/lib/ai/context-builder.ts";

function createStubSupabase() {
  const emptyResult = { data: [], error: null, count: 0 };
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve(emptyResult),
              }),
              then: (fn: (value: typeof emptyResult) => unknown) =>
                Promise.resolve(emptyResult).then(fn),
            }),
            then: (fn: (value: typeof emptyResult) => unknown) =>
              Promise.resolve(emptyResult).then(fn),
            gte: () => ({
              order: () => ({
                limit: () => Promise.resolve(emptyResult),
              }),
            }),
          }),
          maybeSingle: () =>
            Promise.resolve({
              data: { name: "Test Org", slug: "test", org_type: null, description: null },
              error: null,
            }),
        }),
      }),
    }),
  } as unknown as Parameters<typeof buildSystemPrompt>[0]["serviceSupabase"];
}

test("system prompt includes AVAILABLE TOOLS section", async () => {
  const prompt = await buildSystemPrompt({
    orgId: "org-1",
    userId: "user-1",
    role: "admin",
    serviceSupabase: createStubSupabase(),
  });
  assert.match(prompt, /AVAILABLE TOOLS/);
  assert.match(prompt, /read-only tools/);
  assert.match(prompt, /untrusted data/i);
});

test("system prompt includes tool usage guidance", async () => {
  const prompt = await buildSystemPrompt({
    orgId: "org-1",
    userId: "user-1",
    role: "admin",
    serviceSupabase: createStubSupabase(),
  });
  assert.match(prompt, /Do NOT use tools for greetings/);
  assert.match(prompt, /do not emit user-visible filler text/i);
});
