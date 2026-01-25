import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { detectConnector } from "../src/lib/schedule-connectors/registry";
import { vendorAConnector } from "../src/lib/schedule-connectors/vendorA";
import { vendorBConnector } from "../src/lib/schedule-connectors/vendorB";
import { syncScheduleEvents, dedupeEvents } from "../src/lib/schedule-connectors/storage";
import { setAllowlistOverride } from "../src/lib/schedule-security/allowlist";

function fixturePath(name: string) {
  return new URL(`../src/lib/schedule-connectors/__fixtures__/${name}`, import.meta.url);
}

const originalFetch = globalThis.fetch;
const BASE_URL = "https://203.0.113.10";

setAllowlistOverride(["203.0.113.10"]);

test("detectConnector chooses ICS for .ics URLs", async () => {
  const result = await detectConnector(`${BASE_URL}/schedule.ics`);
  assert.equal(result.connector.id, "ics");
});

test("vendorA canHandle recognizes fixture HTML", async () => {
  const html = await readFile(fixturePath("vendorA_sample.html"), "utf-8");
  const result = await vendorAConnector.canHandle({ url: `${BASE_URL}/vendorA`, html });
  assert.equal(result.ok, true);
  assert.ok(result.confidence >= 0.5);
});

test("vendorB canHandle recognizes fixture HTML", async () => {
  const html = await readFile(fixturePath("vendorB_sample.html"), "utf-8");
  const result = await vendorBConnector.canHandle({ url: `${BASE_URL}/vendorB`, html });
  assert.equal(result.ok, true);
  assert.ok(result.confidence >= 0.4);
});

test("preview returns normalized events for vendor connectors", async () => {
  const vendorAHtml = await readFile(fixturePath("vendorA_sample.html"), "utf-8");
  const vendorBHtml = await readFile(fixturePath("vendorB_sample.html"), "utf-8");
  const icsText = await readFile(fixturePath("sample.ics"), "utf-8");

  globalThis.fetch = async (url: RequestInfo | URL) => {
    const urlString = url.toString();
    if (urlString.endsWith(".ics")) {
      return new Response(icsText, { status: 200, headers: { "content-type": "text/calendar" } });
    }
    if (urlString.includes("vendorA")) {
      return new Response(vendorAHtml, { status: 200, headers: { "content-type": "text/html" } });
    }
    if (urlString.includes("vendorB")) {
      return new Response(vendorBHtml, { status: 200, headers: { "content-type": "text/html" } });
    }

    return new Response("not found", { status: 404 });
  };

  const previewA = await vendorAConnector.preview({ url: `${BASE_URL}/vendorA`, orgId: "org-1" });
  assert.equal(previewA.vendor, "vendorA");
  assert.ok(previewA.events.length > 0);
  assert.ok(previewA.events[0].external_uid);

  const previewB = await vendorBConnector.preview({ url: `${BASE_URL}/vendorB`, orgId: "org-1" });
  assert.equal(previewB.vendor, "vendorB");
  assert.ok(previewB.events.length > 0);
  assert.ok(previewB.events.length > 0);

  globalThis.fetch = originalFetch;
});

test("syncScheduleEvents upserts unique events and cancels missing", async () => {
  const existing = [
    { id: "1", external_uid: "uid-1", status: "confirmed" },
    { id: "2", external_uid: "uid-2", status: "confirmed" },
  ];

  const upserted: unknown[] = [];
  const cancelled: string[][] = [];

  const mockSupabase = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                gte() {
                  return {
                    lte() {
                      return Promise.resolve({ data: existing, error: null });
                    },
                  };
                },
              };
            },
          };
        },
        upsert(rows: unknown[]) {
          upserted.push(...rows);
          return Promise.resolve({ data: null, error: null });
        },
        update() {
          return {
            eq() {
              return {
                in(_column: string, values: string[]) {
                  cancelled.push(values);
                  return Promise.resolve({ data: null, error: null });
                },
              };
            },
          };
        },
      };
    },
  } as unknown as Parameters<typeof syncScheduleEvents>[0];

  const events = dedupeEvents([
    {
      external_uid: "uid-1",
      title: "Game",
      start_at: "2025-02-10T17:00:00Z",
      end_at: "2025-02-10T19:00:00Z",
      location: "Field",
    },
    {
      external_uid: "uid-1",
      title: "Game",
      start_at: "2025-02-10T17:00:00Z",
      end_at: "2025-02-10T19:00:00Z",
      location: "Field",
    },
  ]);

  const result = await syncScheduleEvents(mockSupabase, {
    orgId: "org-1",
    sourceId: "source-1",
    events,
    window: { from: new Date("2025-02-01T00:00:00Z"), to: new Date("2025-02-28T23:59:59Z") },
    now: new Date("2025-02-01T00:00:00Z"),
  });

  assert.equal(result.imported, 0);
  assert.equal(result.updated, 1);
  assert.equal(result.cancelled, 1);
  assert.equal(upserted.length, 1);
  assert.deepEqual(cancelled.flat(), ["uid-2"]);
});

process.on("exit", () => {
  globalThis.fetch = originalFetch;
  setAllowlistOverride(null);
});
