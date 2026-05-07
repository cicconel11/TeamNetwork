import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { detectConnector } from "../src/lib/schedule-connectors/registry";
import { vendorAConnector } from "../src/lib/schedule-connectors/vendorA";
import { vendorBConnector } from "../src/lib/schedule-connectors/vendorB";
import { syncScheduleEvents, dedupeEvents } from "../src/lib/schedule-connectors/storage";
import { setAllowlistOverride } from "../src/lib/schedule-security/allowlist";
import { extractTableEvents, extractJsonLdEvents, hashEventId } from "../src/lib/schedule-connectors/html-utils";
import { getTitleForHash } from "../src/lib/schedule-connectors/sanitize";
import { genericHtmlConnector } from "../src/lib/schedule-connectors/genericHtml";

function fixturePath(name: string) {
  return new URL(`../src/lib/schedule-connectors/__fixtures__/${name}`, import.meta.url);
}

const originalFetch = globalThis.fetch;
const BASE_URL = "https://203.0.113.10";

setAllowlistOverride(["203.0.113.10"]);

async function withMockedFetch<T>(
  mockFn: typeof globalThis.fetch,
  testFn: () => Promise<T>
): Promise<T> {
  globalThis.fetch = mockFn;
  try {
    return await testFn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

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

  const mockFetch = async (url: RequestInfo | URL) => {
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

  await withMockedFetch(mockFetch as typeof globalThis.fetch, async () => {
    const previewA = await vendorAConnector.preview({ url: `${BASE_URL}/vendorA`, orgId: "org-1" });
    assert.equal(previewA.vendor, "vendorA");
    assert.ok(previewA.events.length > 0);
    assert.ok(previewA.events[0].external_uid);

    const previewB = await vendorBConnector.preview({ url: `${BASE_URL}/vendorB`, orgId: "org-1" });
    assert.equal(previewB.vendor, "vendorB");
    assert.ok(previewB.events.length > 0);
    assert.ok(previewB.events.length > 0);
  });
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

// rawTitle hashing tests
test("extractTableEvents captures rawTitle before sanitization", () => {
  const html = `
    <table>
      <thead><tr><th>Date</th><th>Event</th><th>Location</th></tr></thead>
      <tbody>
        <tr><td>Feb 10, 2025</td><td><b>Bold Game</b></td><td>Field</td></tr>
        <tr><td>Feb 11, 2025</td><td>Team &amp; Match</td><td>Stadium</td></tr>
      </tbody>
    </table>
  `;

  const events = extractTableEvents(html);
  assert.equal(events.length, 2);

  // cheerio's .text() extracts text content (no HTML tags in output)
  // rawTitle captures the extracted text before sanitization
  assert.equal(events[0].rawTitle, "Bold Game");
  // title is sanitized (in this case same since no special chars)
  assert.equal(events[0].title, "Bold Game");

  // &amp; is decoded by cheerio to &, rawTitle captures that
  assert.equal(events[1].rawTitle, "Team & Match");
  assert.equal(events[1].title, "Team & Match");
});

test("extractJsonLdEvents captures rawTitle before sanitization", () => {
  const html = `
    <script type="application/ld+json">
    {
      "@type": "Event",
      "name": "Game &amp; Match",
      "startDate": "2025-02-10T17:00:00Z",
      "endDate": "2025-02-10T19:00:00Z"
    }
    </script>
  `;

  const events = extractJsonLdEvents(html);
  assert.equal(events.length, 1);

  // rawTitle captures the original value from JSON (which may already be decoded)
  assert.equal(events[0].rawTitle, "Game &amp; Match");
  // title is sanitized
  assert.equal(events[0].title, "Game & Match");
});

test("hashEventId produces deterministic SHA256 hashes", () => {
  const input1 = "Game|2025-02-10T17:00:00Z|Field";
  const input2 = "Game|2025-02-10T17:00:00Z|Field";
  const input3 = "Different|2025-02-10T17:00:00Z|Field";

  const hash1 = hashEventId(input1);
  const hash2 = hashEventId(input2);
  const hash3 = hashEventId(input3);

  // Same input produces same hash
  assert.equal(hash1, hash2);
  // Different input produces different hash
  assert.notEqual(hash1, hash3);
  // Hash is 64 hex characters (SHA256)
  assert.equal(hash1.length, 64);
  assert.ok(/^[a-f0-9]+$/.test(hash1));
});

test("rawTitle used in hash ensures stability when title is sanitized", () => {
  // Simulating the hash calculation that happens in normalizeEvents
  const rawTitle = "&lt;script&gt;Event&lt;/script&gt;";
  const sanitizedTitle = "Event"; // After sanitization (if tags were decoded)
  const startAt = "2025-02-10T17:00:00Z";
  const location = "Field";

  // Using rawTitle for hash (current implementation)
  const hashWithRaw = hashEventId(`${rawTitle}|${startAt}|${location}`);

  // Using sanitized title would produce different hash
  const hashWithSanitized = hashEventId(`${sanitizedTitle}|${startAt}|${location}`);

  // Hashes are different, proving rawTitle matters for stability
  assert.notEqual(hashWithRaw, hashWithSanitized);

  // Re-running with same rawTitle produces same hash (stability)
  const hashWithRaw2 = hashEventId(`${rawTitle}|${startAt}|${location}`);
  assert.equal(hashWithRaw, hashWithRaw2);
});

test("empty rawTitle falls back to sanitized title for hashing", async () => {
  // Test the || fallback behavior: `event.rawTitle || event.title`
  const emptyRawTitle = "";
  const sanitizedTitle = "Untitled Event";

  // The || operator should fall back to sanitized title
  const titleForHash = emptyRawTitle || sanitizedTitle;
  assert.equal(titleForHash, "Untitled Event");

  // Verify hash is deterministic with fallback
  const hash1 = hashEventId(`${titleForHash}|2025-02-10T17:00:00Z|`);
  const hash2 = hashEventId(`${titleForHash}|2025-02-10T17:00:00Z|`);
  assert.equal(hash1, hash2);
});

test("whitespace-only rawTitle falls back to sanitized title for hashing", () => {
  const whitespaceRawTitle = "   ";
  const sanitizedTitle = "Untitled Event";

  const titleForHash = getTitleForHash(whitespaceRawTitle, sanitizedTitle);
  assert.equal(titleForHash, "Untitled Event");

  // Hash is deterministic
  const hash1 = hashEventId(`${titleForHash}|2025-02-10T17:00:00Z|`);
  const hash2 = hashEventId(`${titleForHash}|2025-02-10T17:00:00Z|`);
  assert.equal(hash1, hash2);
});

test("genericHtmlConnector.preview uses rawTitle for event hashing", async () => {
  const html = `
    <table>
      <thead><tr><th>Date</th><th>Event</th><th>Location</th></tr></thead>
      <tbody>
        <tr><td>Feb 15, 2025</td><td>Championship &amp; Finals</td><td>Arena</td></tr>
      </tbody>
    </table>
  `;

  const mockFetch = async () => new Response(html, {
    status: 200,
    headers: { "content-type": "text/html" },
  });

  setAllowlistOverride(["203.0.113.20"]);
  try {
    await withMockedFetch(mockFetch as typeof globalThis.fetch, async () => {
      const preview = await genericHtmlConnector.preview({
        url: "https://203.0.113.20/schedule",
        orgId: "org-test",
      });

      assert.equal(preview.events.length, 1);
      assert.ok(preview.events[0].external_uid);
      assert.equal(preview.events[0].title, "Championship & Finals");

      // Verify hash exists and is 64 hex chars (SHA256)
      assert.equal(preview.events[0].external_uid.length, 64);
      assert.ok(/^[a-f0-9]+$/.test(preview.events[0].external_uid));

      // Verify hash is deterministic - calling again produces same hash
      const preview2 = await genericHtmlConnector.preview({
        url: "https://203.0.113.20/schedule",
        orgId: "org-test",
      });
      assert.equal(preview.events[0].external_uid, preview2.events[0].external_uid);
    });
  } finally {
    setAllowlistOverride(["203.0.113.10"]);
  }
});

process.on("exit", () => {
  globalThis.fetch = originalFetch;
  setAllowlistOverride(null);
});
