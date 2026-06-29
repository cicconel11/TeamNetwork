import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { projectFields } from "../src/lib/ai/tools/shared.ts";

describe("projectFields", () => {
  it("returns only the requested keys present on the row", () => {
    const row = { id: "1", name: "Ada", email: "a@x.com", summary: "long bio" };
    const result = projectFields(row, ["name", "email"]) as Record<string, unknown>;
    assert.deepEqual(result, { name: "Ada", email: "a@x.com" });
  });

  it("omits a requested key the row does not have (never adds keys)", () => {
    const row = { id: "1", name: "Ada" };
    const result = projectFields(row, ["name", "email"]) as Record<string, unknown>;
    assert.deepEqual(result, { name: "Ada" });
    assert.equal("email" in result, false);
  });

  it("narrows only — a non-requested key is never present even if on the row", () => {
    const row = { name: "Ada", email: "secret@x.com" };
    const result = projectFields(row, ["name"]) as Record<string, unknown>;
    assert.equal("email" in result, false);
  });

  it("returns an empty object when no requested keys match", () => {
    const row = { id: "1", name: "Ada" };
    const result = projectFields(row, ["email" as never]) as Record<string, unknown>;
    assert.deepEqual(result, {});
  });

  it("does not mutate the input row", () => {
    const row = { id: "1", name: "Ada", email: "a@x.com" };
    projectFields(row, ["name"]);
    assert.deepEqual(row, { id: "1", name: "Ada", email: "a@x.com" });
  });

  it("preserves null/undefined field values that were requested", () => {
    const row = { name: "Ada", email: null, summary: undefined };
    const result = projectFields(row, ["email", "summary"]) as Record<string, unknown>;
    assert.equal(result.email, null);
    assert.equal("summary" in result, true);
    assert.equal(result.summary, undefined);
  });

  it("returns non-object inputs unchanged (defensive against unknown payloads)", () => {
    assert.equal(projectFields(null as never, ["a"]), null);
    assert.equal(projectFields("string" as never, ["a"]), "string");
    assert.equal(projectFields(42 as never, ["a"]), 42);
  });

  it("returns arrays unchanged (projection applies to rows, not the list)", () => {
    const arr = [{ name: "Ada" }];
    assert.equal(projectFields(arr as never, ["name"]), arr);
  });
});
