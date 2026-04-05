import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { sanitizeRichTextToPlainText } from "@/lib/security/rich-text";

test("sanitizeRichTextToPlainText strips scripts and HTML tags", () => {
  const result = sanitizeRichTextToPlainText(
    "<p>Hello</p><script>alert(1)</script><ul><li>World</li></ul>"
  );

  assert.equal(result, "Hello\n- World");
});

test("sanitizeRichTextToPlainText decodes safe entities", () => {
  const result = sanitizeRichTextToPlainText("&lt;safe&gt; &amp; sound");
  assert.equal(result, "<safe> & sound");
});

test("member detail page no longer renders enrichment HTML via dangerouslySetInnerHTML", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/[orgSlug]/members/[memberId]/page.tsx"),
    "utf8"
  );

  assert.ok(!source.includes("dangerouslySetInnerHTML"));
});

test("repo guard: files importing sanitizeRichTextToPlainText do not use dangerouslySetInnerHTML", () => {
  const files = execSync(
    "rg -l sanitizeRichTextToPlainText src/ || true",
    { encoding: "utf8" }
  )
    .trim()
    .split("\n")
    .filter(Boolean);

  for (const file of files) {
    if (file === "src/lib/security/rich-text.ts") continue;
    const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    assert.ok(
      !source.includes("dangerouslySetInnerHTML"),
      `${file} imports sanitizeRichTextToPlainText and also uses dangerouslySetInnerHTML. ` +
      "This is blocked by repository policy because sanitizeRichTextToPlainText returns plain text, not HTML-safe markup."
    );
  }
});
