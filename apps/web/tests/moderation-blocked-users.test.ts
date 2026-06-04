import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveBlockedIds,
  blockedIdsInFilter,
} from "@/lib/moderation/blocked-users";

const ME = "11111111-1111-1111-1111-111111111111";
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("deriveBlockedIds (bidirectional block resolution)", () => {
  it("returns users I blocked", () => {
    const ids = deriveBlockedIds([{ blocker_id: ME, blocked_id: A }], ME);
    assert.deepEqual(ids, [A]);
  });

  it("returns users who blocked me (block is mutual — Apple 1.2)", () => {
    const ids = deriveBlockedIds([{ blocker_id: B, blocked_id: ME }], ME);
    assert.deepEqual(ids, [B]);
  });

  it("dedupes when a block exists in both directions", () => {
    const ids = deriveBlockedIds(
      [
        { blocker_id: ME, blocked_id: A },
        { blocker_id: A, blocked_id: ME },
      ],
      ME,
    );
    assert.deepEqual(ids, [A]);
  });

  it("collects multiple distinct blocked parties", () => {
    const ids = deriveBlockedIds(
      [
        { blocker_id: ME, blocked_id: A },
        { blocker_id: B, blocked_id: ME },
      ],
      ME,
    );
    assert.deepEqual(new Set(ids), new Set([A, B]));
  });

  it("returns nothing for rows that don't involve me", () => {
    const ids = deriveBlockedIds([{ blocker_id: A, blocked_id: B }], ME);
    assert.deepEqual(ids, []);
  });
});

describe("blockedIdsInFilter (postgrest .in() formatting)", () => {
  it("returns null for an empty list so callers skip the filter", () => {
    assert.equal(blockedIdsInFilter([]), null);
  });

  it("wraps ids in parentheses, comma-separated", () => {
    assert.equal(blockedIdsInFilter([A, B]), `(${A},${B})`);
  });
});
