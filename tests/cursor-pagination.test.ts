import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  encodeCursor,
  decodeCursor,
  buildCursorResponse,
} from "@/lib/pagination/cursor";

describe("encodeCursor / decodeCursor", () => {
  it("round-trips a valid cursor", () => {
    const createdAt = "2026-01-15T10:30:00.000Z";
    const id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

    const cursor = encodeCursor(createdAt, id);
    assert.ok(typeof cursor === "string");
    assert.ok(cursor.length > 0);

    const decoded = decodeCursor(cursor);
    assert.deepStrictEqual(decoded, { createdAt, id });
  });

  it("produces a base64url string without padding", () => {
    const cursor = encodeCursor("2026-06-01T00:00:00Z", "00000000-0000-0000-0000-000000000001");
    // base64url should not contain +, /, or = characters
    assert.ok(!/[+/=]/.test(cursor));
  });

  it("returns null for empty string", () => {
    assert.strictEqual(decodeCursor(""), null);
  });

  it("returns null for invalid base64", () => {
    assert.strictEqual(decodeCursor("not-valid!!!"), null);
  });

  it("returns null for valid base64 but invalid JSON", () => {
    const cursor = Buffer.from("not json").toString("base64url");
    assert.strictEqual(decodeCursor(cursor), null);
  });

  it("returns null for JSON with wrong shape", () => {
    const cursor = Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64url");
    assert.strictEqual(decodeCursor(cursor), null);
  });

  it("returns null for invalid timestamp", () => {
    const cursor = Buffer.from(JSON.stringify({ t: "not-a-date", i: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" })).toString("base64url");
    assert.strictEqual(decodeCursor(cursor), null);
  });

  it("returns null for invalid UUID", () => {
    const cursor = Buffer.from(JSON.stringify({ t: "2026-01-01T00:00:00Z", i: "not-a-uuid" })).toString("base64url");
    assert.strictEqual(decodeCursor(cursor), null);
  });
});

describe("buildCursorResponse", () => {
  const makeItem = (n: number) => ({
    id: `00000000-0000-0000-0000-00000000000${n}`,
    created_at: `2026-01-0${n}T00:00:00Z`,
    title: `Item ${n}`,
  });

  it("returns hasMore=false when items <= limit", () => {
    const items = [makeItem(3), makeItem(2), makeItem(1)];
    const result = buildCursorResponse(items, 5);

    assert.strictEqual(result.hasMore, false);
    assert.strictEqual(result.nextCursor, null);
    assert.strictEqual(result.data.length, 3);
  });

  it("returns hasMore=true and trims when items > limit", () => {
    const items = [makeItem(4), makeItem(3), makeItem(2), makeItem(1)];
    const result = buildCursorResponse(items, 3);

    assert.strictEqual(result.hasMore, true);
    assert.strictEqual(result.data.length, 3);
    assert.ok(result.nextCursor !== null);

    // Cursor should point to the last item in the page
    const decoded = decodeCursor(result.nextCursor!);
    assert.strictEqual(decoded?.id, makeItem(2).id);
    assert.strictEqual(decoded?.createdAt, makeItem(2).created_at);
  });

  it("returns empty data with no cursor for empty input", () => {
    const result = buildCursorResponse([], 10);

    assert.strictEqual(result.hasMore, false);
    assert.strictEqual(result.nextCursor, null);
    assert.strictEqual(result.data.length, 0);
  });

  it("exactly limit+1 items returns hasMore=true with correct page", () => {
    const items = [makeItem(3), makeItem(2), makeItem(1)];
    const result = buildCursorResponse(items, 2);

    assert.strictEqual(result.hasMore, true);
    assert.strictEqual(result.data.length, 2);
    assert.ok(result.nextCursor !== null);
  });
});
