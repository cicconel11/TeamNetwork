import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("AI panel SSR integration", () => {
  it("dynamically imports AIPanel with SSR disabled in the org layout", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync("src/app/[orgSlug]/layout.tsx", "utf-8");

    assert.ok(code.includes('ssr: false'), "layout should disable SSR for AIPanel");
    assert.ok(code.includes('next/dynamic'), "layout should dynamically import AIPanel");
  });
});

describe("AI panel post-stream refresh", () => {
  it("guards against a redundant effect load after handleSend changes threads", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync(
      "src/components/ai-assistant/AIPanel.tsx",
      "utf-8"
    );

    assert.ok(
      code.includes("skipEffectLoadRef.current = true"),
      "handleSend should set skipEffectLoadRef before changing activeThreadId"
    );
    assert.ok(
      code.includes("skipEffectLoadRef.current") &&
        code.includes("skipEffectLoadRef.current = false"),
      "useEffect should check and reset skipEffectLoadRef"
    );
  });
});
