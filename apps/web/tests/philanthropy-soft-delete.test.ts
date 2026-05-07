/**
 * Philanthropy Soft-Delete Tests
 *
 * Verifies that philanthropy and donation event queries filter out
 * soft-deleted records and use bounded selects.
 *
 * Pattern: source-code audit (reads files, asserts on code shape).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("philanthropy soft-delete filters", () => {
  describe("philanthropy/page.tsx", () => {
    const file = "src/app/[orgSlug]/philanthropy/page.tsx";

    it("eventsQuery includes .is('deleted_at', null)", () => {
      const source = readSource(file);
      // The eventsQuery block (first events query) must filter deleted_at
      const eventsQueryIdx = source.indexOf("eventsQuery");
      assert.ok(eventsQueryIdx > -1, "eventsQuery must exist");
      // Find the block between eventsQuery definition and its first usage
      const block = source.slice(eventsQueryIdx, eventsQueryIdx + 400);
      assert.ok(
        block.includes('.is("deleted_at", null)') || block.includes(".is('deleted_at', null)"),
        "eventsQuery must filter .is('deleted_at', null)",
      );
    });

    it("allPhilanthropyEvents includes .is('deleted_at', null)", () => {
      const source = readSource(file);
      const idx = source.indexOf("allPhilanthropyEvents");
      assert.ok(idx > -1, "allPhilanthropyEvents query must exist");
      // Check the query block around allPhilanthropyEvents
      const block = source.slice(idx, idx + 600);
      assert.ok(
        block.includes('.is("deleted_at", null)') || block.includes(".is('deleted_at', null)"),
        "allPhilanthropyEvents must filter .is('deleted_at', null)",
      );
    });

    it("allPhilanthropyEvents uses narrow select, not select('*')", () => {
      const source = readSource(file);
      // Find the second events query (allPhilanthropyEvents) by locating the
      // destructuring and then finding the .from("events") call after it
      const destructIdx = source.indexOf("allPhilanthropyEvents");
      assert.ok(destructIdx > -1);
      const fromEventsIdx = source.indexOf('.from("events")', destructIdx);
      assert.ok(fromEventsIdx > -1, "allPhilanthropyEvents must query events table");
      // Limit window to this query only (stop at next `supabase` call)
      const rest = source.slice(fromEventsIdx);
      const nextQuery = rest.indexOf("supabase", 1);
      const queryBlock = nextQuery > -1 ? rest.slice(0, nextQuery) : rest.slice(0, 300);
      assert.ok(
        !queryBlock.includes('.select("*")'),
        "allPhilanthropyEvents must not use select('*')",
      );
      assert.ok(
        queryBlock.includes("id") && queryBlock.includes("title") && queryBlock.includes("start_date"),
        "allPhilanthropyEvents select must include id, title, start_date",
      );
    });

    it("eventsQuery does not use a .limit()", () => {
      const source = readSource(file);
      const eventsQueryIdx = source.indexOf("eventsQuery");
      // Find the eventsQuery block up to Promise.all
      const promiseAllIdx = source.indexOf("Promise.all");
      const block = source.slice(eventsQueryIdx, promiseAllIdx > -1 ? promiseAllIdx : eventsQueryIdx + 500);
      assert.ok(!block.includes(".limit("), "eventsQuery must not silently truncate results");
    });

    it("allPhilanthropyEvents does not use a .limit()", () => {
      const source = readSource(file);
      const idx = source.indexOf("allPhilanthropyEvents");
      const block = source.slice(idx, idx + 600);
      assert.ok(
        !block.includes(".limit("),
        "allPhilanthropyEvents must not silently truncate counts or donation form options",
      );
    });

    it("allPhilanthropyEvents orders by start_date for stable UI output", () => {
      const source = readSource(file);
      const idx = source.indexOf("allPhilanthropyEvents");
      const block = source.slice(idx, idx + 600);
      assert.ok(block.includes('.order("start_date")'), "allPhilanthropyEvents must order by start_date");
    });
  });

  describe("donations/page.tsx", () => {
    const file = "src/app/[orgSlug]/donations/page.tsx";

    it("philanthropyEvents query includes .is('deleted_at', null)", () => {
      const source = readSource(file);
      const idx = source.indexOf("philanthropyEvents");
      assert.ok(idx > -1, "philanthropyEvents query must exist");
      const block = source.slice(idx, idx + 400);
      assert.ok(
        block.includes('.is("deleted_at", null)') || block.includes(".is('deleted_at', null)"),
        "philanthropyEvents must filter .is('deleted_at', null)",
      );
    });
  });
});
