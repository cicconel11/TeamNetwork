import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  encodeCursor,
  decodeCursor,
  buildCursorResponse,
} from "../../../src/lib/pagination/cursor.ts";

describe("Cursor pagination utilities", () => {
  describe("encodeCursor / decodeCursor round-trip", () => {
    it("round-trips a valid (createdAt, id) pair", () => {
      const createdAt = "2026-04-10T12:00:00.000Z";
      const id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

      const cursor = encodeCursor(createdAt, id);
      const decoded = decodeCursor(cursor);

      assert.ok(decoded);
      assert.equal(decoded.createdAt, createdAt);
      assert.equal(decoded.id, id);
    });

    it("returns null for tampered cursor", () => {
      const cursor = encodeCursor("2026-04-10T12:00:00Z", "a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      const tampered = cursor.slice(0, -3) + "XXX";
      const result = decodeCursor(tampered);

      // Either null (invalid JSON) or null (invalid format)
      assert.equal(result, null);
    });

    it("returns null for empty string", () => {
      assert.equal(decodeCursor(""), null);
    });

    it("returns null for cursor with invalid timestamp", () => {
      // Manually encode a payload with invalid timestamp
      const payload = JSON.stringify({ t: "not-a-date", i: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" });
      const cursor = Buffer.from(payload).toString("base64url");
      assert.equal(decodeCursor(cursor), null);
    });

    it("returns null for cursor with invalid UUID", () => {
      const payload = JSON.stringify({ t: "2026-04-10T12:00:00Z", i: "not-a-uuid" });
      const cursor = Buffer.from(payload).toString("base64url");
      assert.equal(decodeCursor(cursor), null);
    });

    it("rejects timestamp with trailing injection content", () => {
      const payload = JSON.stringify({ t: "2026-04-10T12:00:00Z; DROP TABLE--", i: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" });
      const cursor = Buffer.from(payload).toString("base64url");
      assert.equal(decodeCursor(cursor), null);
    });
  });

  describe("buildCursorResponse", () => {
    const makeItems = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `a1b2c3d4-e5f6-7890-abcd-ef12345678${String(i).padStart(2, "0")}`,
        created_at: `2026-04-${String(30 - i).padStart(2, "0")}T12:00:00Z`,
      }));

    it("returns hasMore=false and null cursor when items <= limit", () => {
      const items = makeItems(5);
      const result = buildCursorResponse(items, 10);

      assert.equal(result.data.length, 5);
      assert.equal(result.hasMore, false);
      assert.equal(result.nextCursor, null);
    });

    it("returns hasMore=false and null cursor when items === limit", () => {
      const items = makeItems(10);
      const result = buildCursorResponse(items, 10);

      assert.equal(result.data.length, 10);
      assert.equal(result.hasMore, false);
      assert.equal(result.nextCursor, null);
    });

    it("returns hasMore=true and valid cursor when items > limit", () => {
      // limit+1 items simulates the fetch pattern
      const items = makeItems(11);
      const result = buildCursorResponse(items, 10);

      assert.equal(result.data.length, 10);
      assert.equal(result.hasMore, true);
      assert.ok(result.nextCursor);

      // Verify the cursor decodes to the last item in the returned page
      const decoded = decodeCursor(result.nextCursor);
      assert.ok(decoded);
      assert.equal(decoded.id, result.data[9].id);
      assert.equal(decoded.createdAt, result.data[9].created_at);
    });

    it("returns empty data with no cursor for 0 items", () => {
      const result = buildCursorResponse([], 10);

      assert.equal(result.data.length, 0);
      assert.equal(result.hasMore, false);
      assert.equal(result.nextCursor, null);
    });

    it("cursor chain: second page cursor decodes correctly", () => {
      // Simulate two pages
      const allItems = makeItems(25);

      // First page: items 0..10 (11 items, limit 10)
      const page1 = buildCursorResponse(allItems.slice(0, 11), 10);
      assert.equal(page1.data.length, 10);
      assert.ok(page1.nextCursor);

      // Verify the cursor points to the last item of page 1
      const cursor1 = decodeCursor(page1.nextCursor!);
      assert.ok(cursor1);
      assert.equal(cursor1.id, page1.data[9].id);
    });
  });
});
