import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function squishWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
}

test("calendar feed event rows use a wrapped layout instead of a fixed-width nowrap time column", () => {
  const source = readSource("src/components/calendar/UnifiedEventFeed.tsx");
  const normalized = squishWhitespace(source);

  assert.strictEqual(
    normalized.includes('className="text-sm text-muted-foreground w-32 flex-shrink-0 whitespace-nowrap tabular-nums"'),
    false,
    "calendar feed rows must not use the old fixed-width nowrap time column",
  );
  assert.ok(
    normalized.includes('className="min-w-0 flex-1 space-y-1"'),
    "calendar feed rows must use a stacked content container",
  );
  assert.ok(
    normalized.includes('className="grid gap-1 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:gap-x-4"'),
    "calendar feed rows must separate time and title into responsive layout regions",
  );
  assert.ok(
    normalized.includes('className="flex flex-wrap items-center gap-2"'),
    "calendar feed metadata must wrap instead of competing on the same line as the title",
  );
});
