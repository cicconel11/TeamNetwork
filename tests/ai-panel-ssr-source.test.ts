import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("AI panel SSR integration", () => {
  it("does not disable SSR for AIPanel in the org layout", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync("src/app/[orgSlug]/layout.tsx", "utf-8");

    assert.ok(!code.includes('ssr: false'), "layout should not disable SSR for AIPanel");
    assert.ok(!code.includes('next/dynamic'), "layout should not dynamically import AIPanel");
  });
});
