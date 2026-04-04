import test from "node:test";
import assert from "node:assert/strict";
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
