import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

describe("middleware well-known bypass", () => {
  it("bypasses /.well-known probes before auth logic", async () => {
    const code = await readFile("src/middleware.ts", "utf8");

    assert.match(code, /pathname\.startsWith\(\"\/\.well-known\/\"\)/);
  });
});
