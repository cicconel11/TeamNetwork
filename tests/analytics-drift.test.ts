/**
 * STATIC CONTRACT TEST
 * Asserts on source code structure rather than runtime behavior.
 * Secondary signal — a failure indicates a pattern violation to investigate,
 * not necessarily a runtime bug.
 */
/**
 * Analytics Drift Tests
 *
 * Catches schema/type misalignment and unwired events.
 *
 * Convention constraint: these tests assume trackBehavioralEvent is always
 * called with string literals (e.g., trackBehavioralEvent("event_name", ...)).
 * No wrappers or dynamic construction exist today. If wrappers are introduced,
 * update the call-site grep pattern accordingly.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Helpers — extract event names from source files at build time
// ---------------------------------------------------------------------------

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

/**
 * Extract BEHAVIORAL_EVENT_NAMES array entries from events.ts source.
 * Matches the `export const BEHAVIORAL_EVENT_NAMES = [...] as const;` pattern.
 */
function extractBehavioralEventNames(): string[] {
  const source = readSource("src/lib/analytics/events.ts");
  const match = source.match(
    /export const BEHAVIORAL_EVENT_NAMES\s*=\s*\[([\s\S]*?)\]\s*as\s*const/,
  );
  assert.ok(match, "BEHAVIORAL_EVENT_NAMES const array not found in events.ts");
  const entries = match[1].match(/"([^"]+)"/g);
  assert.ok(entries?.length, "BEHAVIORAL_EVENT_NAMES has no entries");
  return entries.map((e) => e.replace(/"/g, ""));
}

/**
 * Extract event names from the analyticsEventSchema discriminated union.
 * Matches `z.literal("event_name")` patterns within the schema definition.
 */
function extractSchemaEventNames(): string[] {
  const source = readSource("src/lib/schemas/analytics.ts");
  const match = source.match(
    /export const analyticsEventSchema\s*=\s*z\.discriminatedUnion\(\s*"event_name"\s*,\s*\[([\s\S]*?)\]\s*\)/,
  );
  assert.ok(match, "analyticsEventSchema not found in analytics.ts");
  const literals = match[1].match(/z\.literal\("([^"]+)"\)/g);
  assert.ok(literals?.length, "analyticsEventSchema has no event literals");
  return literals.map((l) => {
    const m = l.match(/z\.literal\("([^"]+)"\)/);
    return m![1];
  });
}

function extractDatabaseEventNames(): string[] {
  const source = readSource("src/types/database.ts");
  const match = source.match(
    /analytics_event_name:\s*\[([\s\S]*?)\]\s*,/,
  );
  assert.ok(match, "analytics_event_name constants array not found in database.ts");
  const entries = match[1].match(/"([^"]+)"/g);
  assert.ok(entries?.length, "analytics_event_name constants array has no entries");
  return entries.map((entry) => entry.replace(/"/g, ""));
}

// ---------------------------------------------------------------------------
// 4a: Schema <-> type alignment
// ---------------------------------------------------------------------------

describe("Analytics drift - schema/type alignment", () => {
  it("BEHAVIORAL_EVENT_NAMES and analyticsEventSchema have identical event sets", () => {
    const typeNames = new Set(extractBehavioralEventNames());
    const schemaNames = new Set(extractSchemaEventNames());

    const inTypeNotSchema = [...typeNames].filter((n) => !schemaNames.has(n));
    const inSchemaNotType = [...schemaNames].filter((n) => !typeNames.has(n));

    assert.deepStrictEqual(
      inTypeNotSchema,
      [],
      `Events in BEHAVIORAL_EVENT_NAMES but missing from analyticsEventSchema: ${inTypeNotSchema.join(", ")}`,
    );
    assert.deepStrictEqual(
      inSchemaNotType,
      [],
      `Events in analyticsEventSchema but missing from BEHAVIORAL_EVENT_NAMES: ${inSchemaNotType.join(", ")}`,
    );
  });

  it("BEHAVIORAL_EVENT_NAMES has exactly 16 entries", () => {
    const names = extractBehavioralEventNames();
    assert.strictEqual(names.length, 16);
  });

  it("generated database analytics_event_name constants match BEHAVIORAL_EVENT_NAMES", () => {
    const behavioralNames = new Set(extractBehavioralEventNames());
    const databaseNames = new Set(extractDatabaseEventNames());

    const inBehavioralNotDatabase = [...behavioralNames].filter((name) => !databaseNames.has(name));
    const inDatabaseNotBehavioral = [...databaseNames].filter((name) => !behavioralNames.has(name));

    assert.deepStrictEqual(
      inBehavioralNotDatabase,
      [],
      `Events in BEHAVIORAL_EVENT_NAMES but missing from database constants: ${inBehavioralNotDatabase.join(", ")}`,
    );
    assert.deepStrictEqual(
      inDatabaseNotBehavioral,
      [],
      `Events in database constants but missing from BEHAVIORAL_EVENT_NAMES: ${inDatabaseNotBehavioral.join(", ")}`,
    );
  });
});

// ---------------------------------------------------------------------------
// 4b: Call-site coverage
// ---------------------------------------------------------------------------

describe("Analytics drift - call-site coverage", () => {
  it("every BEHAVIORAL_EVENT_NAMES entry has at least one trackBehavioralEvent call site in src/", () => {
    const names = extractBehavioralEventNames();
    const missing: string[] = [];

    for (const name of names) {
      try {
        // Use grep -P with multiline or just search for the event name string
        // near trackBehavioralEvent (may be on the next line in multiline calls)
        const result = execSync(
          `grep -rl '"${name}"' src/ --include='*.ts' --include='*.tsx' | xargs grep -l 'trackBehavioralEvent' 2>/dev/null || true`,
          { encoding: "utf8" },
        );
        // Filter out the events.ts definition file itself
        const files = result
          .trim()
          .split("\n")
          .filter((f) => f && !f.includes("analytics/events.ts") && !f.includes("schemas/analytics.ts"));
        if (files.length === 0) {
          missing.push(name);
        }
      } catch {
        missing.push(name);
      }
    }

    assert.deepStrictEqual(
      missing,
      [],
      `Events with no trackBehavioralEvent call sites: ${missing.join(", ")}`,
    );
  });
});
