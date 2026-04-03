import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const EXECUTOR_SOURCE_PATH = new URL("../../../src/lib/ai/tools/executor.ts", import.meta.url);

test("executor lazy-loads schedule-only dependencies", () => {
  const source = readFileSync(EXECUTOR_SOURCE_PATH, "utf8");

  assert.doesNotMatch(source, /^import\s+\{\s*load\s*\}\s+from\s+"cheerio";$/m);
  assert.doesNotMatch(source, /^import\s+\{\s*PDFParse\s*\}\s+from\s+"pdf-parse";$/m);
  assert.doesNotMatch(
    source,
    /^import\s+\{\s*extractScheduleFromImage,\s*extractScheduleFromText,[\s\S]*\}\s+from\s+"@\/lib\/ai\/schedule-extraction";$/m
  );

  assert.match(source, /async function getCheerioLoad\(\)/);
  assert.match(source, /async function getPdfParseCtor\(\)/);
  assert.match(source, /async function getScheduleExtractionModule\(\)/);
  assert.match(source, /await import\("cheerio"\)/);
  assert.match(source, /await import\("pdf-parse"\)/);
  assert.match(source, /await import\("@\/lib\/ai\/schedule-extraction"\)/);
});
