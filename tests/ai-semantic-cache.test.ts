/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Pure-function imports — no mocking needed
// ---------------------------------------------------------------------------

import {
  normalizePrompt,
  hashPrompt,
  buildPermissionScopeKey,
  checkCacheEligibility,
  getCacheExpiresAt,
} from "../src/lib/ai/semantic-cache-utils.ts";

// ---------------------------------------------------------------------------
// Mock Supabase factory
// ---------------------------------------------------------------------------

interface MockSelectResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}

interface MockInsertRow {
  org_id: string;
  surface: string;
  permission_scope_key: string;
  cache_version: number;
  prompt_normalized: string;
  prompt_hash: string;
  response_content: string;
  source_message_id: string;
  expires_at: string;
}

interface MockInvalidationRow {
  invalidated_at: string;
  invalidation_reason: string;
}

function createMockServiceSupabase(opts: {
  selectResult?: MockSelectResult;
  insertResult?: MockSelectResult;
  captureInsertRow?: (row: MockInsertRow) => void;
  captureInvalidationRow?: (row: MockInvalidationRow) => void;
}) {
  return {
    from: () => ({
      select: () => ({
        eq: function () { return this; },
        is: function () { return this; },
        gt: function () { return this; },
        limit: function () { return this; },
        maybeSingle: async () => opts.selectResult ?? { data: null, error: null },
      }),
      update: (row: MockInvalidationRow) => {
        opts.captureInvalidationRow?.(row);
        return {
          eq: function () { return this; },
          is: function () { return this; },
          lte: async function () {
            return { data: null, error: null };
          },
        };
      },
      insert: async (row: MockInsertRow) => {
        opts.captureInsertRow?.(row);
        return opts.insertResult ?? { data: null, error: null };
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// normalizePrompt
// ---------------------------------------------------------------------------

describe("normalizePrompt", () => {
  it("lowercases text", () => {
    assert.equal(normalizePrompt("HELLO WORLD"), "hello world");
  });

  it("collapses multiple whitespace to a single space", () => {
    assert.equal(normalizePrompt("hello   world\t\nfoo"), "hello world foo");
  });

  it("strips zero-width space U+200B", () => {
    assert.equal(normalizePrompt("hello\u200Bworld"), "helloworld");
  });

  it("strips zero-width joiner U+200D", () => {
    assert.equal(normalizePrompt("hello\u200Dworld"), "helloworld");
  });

  it("strips BOM / zero-width no-break space U+FEFF", () => {
    assert.equal(normalizePrompt("\uFEFFhello"), "hello");
  });

  it("NFC normalizes Unicode (composed vs decomposed é)", () => {
    const decomposed = "e\u0301"; // e + combining acute accent
    const composed = "\u00E9";   // é precomposed
    assert.equal(normalizePrompt(decomposed), normalizePrompt(composed));
  });

  it("trims leading and trailing whitespace", () => {
    assert.equal(normalizePrompt("  hello  "), "hello");
  });
});

// ---------------------------------------------------------------------------
// hashPrompt
// ---------------------------------------------------------------------------

describe("hashPrompt", () => {
  it("returns the same hex string for the same input", () => {
    const h1 = hashPrompt("what are the bylaws?");
    const h2 = hashPrompt("what are the bylaws?");
    assert.equal(h1, h2);
  });

  it("produces different hashes for different inputs", () => {
    assert.notEqual(hashPrompt("hello"), hashPrompt("world"));
  });

  it("returns a 64-character hex string (SHA-256)", () => {
    const hash = hashPrompt("test input");
    assert.match(hash, /^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// buildPermissionScopeKey
// ---------------------------------------------------------------------------

describe("buildPermissionScopeKey", () => {
  it("returns consistent hash for same orgId and role", () => {
    const k1 = buildPermissionScopeKey("org-1", "admin");
    const k2 = buildPermissionScopeKey("org-1", "admin");
    assert.equal(k1, k2);
  });

  it("produces different key when orgId differs", () => {
    assert.notEqual(
      buildPermissionScopeKey("org-1", "admin"),
      buildPermissionScopeKey("org-2", "admin")
    );
  });

  it("produces different key when role differs", () => {
    assert.notEqual(
      buildPermissionScopeKey("org-1", "admin"),
      buildPermissionScopeKey("org-1", "active_member")
    );
  });

  it("returns a 64-character hex string", () => {
    const key = buildPermissionScopeKey("org-1", "admin");
    assert.match(key, /^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// checkCacheEligibility
// ---------------------------------------------------------------------------

describe("checkCacheEligibility", () => {
  it("returns eligible for a clean informational prompt", () => {
    const result = checkCacheEligibility({
      message: "What are the organization bylaws?",
      surface: "general",
    });
    assert.equal(result.eligible, true);
    assert.equal(result.reason, "cacheable");
  });

  it("returns ineligible with bypass_requested when bypassCache=true", () => {
    const result = checkCacheEligibility({
      message: "What are the organization bylaws?",
      surface: "general",
      bypassCache: true,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "bypass_requested");
  });

  it("returns ineligible with unsupported_surface for non-general surfaces", () => {
    const result = checkCacheEligibility({
      message: "What are the organization bylaws?",
      surface: "events",
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "unsupported_surface");
  });

  it("returns ineligible with has_thread_context when threadId is provided", () => {
    const result = checkCacheEligibility({
      message: "What are the organization bylaws?",
      surface: "general",
      threadId: "thread-123",
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "has_thread_context");
  });

  it("returns ineligible with message_too_short for very short messages", () => {
    const result = checkCacheEligibility({
      message: "Hi",
      surface: "general",
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "message_too_short");
  });

  it("returns ineligible with message_too_long for messages exceeding 2000 chars", () => {
    const result = checkCacheEligibility({
      message: "a".repeat(2001),
      surface: "general",
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "message_too_long");
  });

  it("accepts a message of exactly 2000 chars as eligible (no temporal/personal markers)", () => {
    // Build a 2000-char message free of ineligibility markers
    const base = "Tell the group about bylaws ";
    const padding = "z".repeat(2000 - base.length);
    const result = checkCacheEligibility({
      message: base + padding,
      surface: "general",
    });
    assert.equal(result.eligible, true);
  });

  it("returns ineligible with contains_temporal_marker for 'What happened today?'", () => {
    const result = checkCacheEligibility({
      message: "What happened today?",
      surface: "general",
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "contains_temporal_marker");
  });

  it("returns ineligible for prompts containing 'latest'", () => {
    const result = checkCacheEligibility({
      message: "Show the latest announcements",
      surface: "general",
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "contains_temporal_marker");
  });

  it("returns ineligible with contains_personalization for 'Show me my profile'", () => {
    const result = checkCacheEligibility({
      message: "Show me my profile",
      surface: "general",
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "contains_personalization");
  });

  it("returns ineligible with requires_live_org_context for org-data questions", () => {
    const result = checkCacheEligibility({
      message: "Summarize the member roster for this organization",
      surface: "general",
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "requires_live_org_context");
  });

  it("returns ineligible with implies_write_or_tool for 'Create an annual event'", () => {
    const result = checkCacheEligibility({
      message: "Create a welcome page for the organization",
      surface: "general",
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "implies_write_or_tool");
  });

  it("word boundary: 'renew' should NOT match 'new'", () => {
    const cleanResult = checkCacheEligibility({
      message: "How does renewal work for the organization?",
      surface: "general",
    });
    assert.equal(cleanResult.eligible, true, "'renewal' should not match 'new'");
  });

  it("word boundary: 'historical' should NOT match 'last' or 'today'", () => {
    const result = checkCacheEligibility({
      message: "What is the historical background of this group?",
      surface: "general",
    });
    assert.equal(result.eligible, true, "'historical' should not match any temporal marker");
  });

  it("returns ineligible for write markers: 'delete'", () => {
    const result = checkCacheEligibility({
      message: "Delete the cached draft response",
      surface: "general",
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "implies_write_or_tool");
  });

  it("returns ineligible for write markers: 'send'", () => {
    const result = checkCacheEligibility({
      message: "Send the policy summary to the board",
      surface: "general",
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "implies_write_or_tool");
  });
});

// ---------------------------------------------------------------------------
// getCacheExpiresAt
// ---------------------------------------------------------------------------

describe("getCacheExpiresAt", () => {
  it("returns a valid ISO date string", () => {
    const result = getCacheExpiresAt("general");
    assert.ok(!isNaN(Date.parse(result)), `Expected valid ISO string, got: ${result}`);
  });

  it("general surface TTL is approximately 24 hours ahead", () => {
    const before = Date.now();
    const result = getCacheExpiresAt("general");
    const after = Date.now();

    const expiresMs = Date.parse(result);
    const expectedMin = before + 23.9 * 60 * 60 * 1000;
    const expectedMax = after + 24.1 * 60 * 60 * 1000;

    assert.ok(
      expiresMs >= expectedMin && expiresMs <= expectedMax,
      `Expected ~24h TTL, got ${result}`
    );
  });

  it("analytics surface TTL is approximately 2 hours ahead", () => {
    const before = Date.now();
    const result = getCacheExpiresAt("analytics");
    const after = Date.now();

    const expiresMs = Date.parse(result);
    const expectedMin = before + 1.9 * 60 * 60 * 1000;
    const expectedMax = after + 2.1 * 60 * 60 * 1000;

    assert.ok(
      expiresMs >= expectedMin && expiresMs <= expectedMax,
      `Expected ~2h TTL, got ${result}`
    );
  });

  it("members surface TTL is approximately 4 hours ahead", () => {
    const before = Date.now();
    const result = getCacheExpiresAt("members");
    const after = Date.now();

    const expiresMs = Date.parse(result);
    const expectedMin = before + 3.9 * 60 * 60 * 1000;
    const expectedMax = after + 4.1 * 60 * 60 * 1000;

    assert.ok(
      expiresMs >= expectedMin && expiresMs <= expectedMax,
      `Expected ~4h TTL, got ${result}`
    );
  });
});

// ---------------------------------------------------------------------------
// lookupSemanticCache
// ---------------------------------------------------------------------------

describe("lookupSemanticCache", () => {
  const baseParams = {
    promptHash: hashPrompt("what are the organization bylaws?"),
    orgId: "org-1",
    surface: "general" as const,
    permissionScopeKey: buildPermissionScopeKey("org-1", "admin"),
  };

  it("returns { ok: true, hit } when cache entry found", async () => {
    const { lookupSemanticCache } = await import("../src/lib/ai/semantic-cache.ts");
    const fakeRow = {
      id: "cache-row-1",
      response_content: "The bylaws state...",
      created_at: "2026-03-01T10:00:00Z",
    };
    const mock = createMockServiceSupabase({
      selectResult: { data: fakeRow, error: null },
    });

    const result = await lookupSemanticCache({
      ...baseParams,
      supabase: mock as any,
    });

    assert.equal(result.ok, true);
    assert.ok(result.ok && result.hit);
    assert.equal(result.ok && result.hit.id, "cache-row-1");
    assert.equal(result.ok && result.hit.responseContent, "The bylaws state...");
    assert.equal(result.ok && result.hit.hitType, "exact");
    assert.equal(result.ok && result.hit.cachedAt, "2026-03-01T10:00:00Z");
  });

  it("returns { ok: false, reason: 'miss' } when no entry found", async () => {
    const { lookupSemanticCache } = await import("../src/lib/ai/semantic-cache.ts");
    const mock = createMockServiceSupabase({
      selectResult: { data: null, error: null },
    });

    const result = await lookupSemanticCache({
      ...baseParams,
      supabase: mock as any,
    });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, "miss");
  });

  it("returns { ok: false, reason: 'error' } on Supabase error", async () => {
    const { lookupSemanticCache } = await import("../src/lib/ai/semantic-cache.ts");
    const mock = createMockServiceSupabase({
      selectResult: { data: null, error: { message: "connection timeout" } },
    });

    const result = await lookupSemanticCache({
      ...baseParams,
      supabase: mock as any,
    });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, "error");
  });
});

// ---------------------------------------------------------------------------
// writeCacheEntry
// ---------------------------------------------------------------------------

describe("writeCacheEntry", () => {
  const baseParams = {
    normalizedPrompt: "what are the organization bylaws?",
    promptHash: hashPrompt("what are the organization bylaws?"),
    responseContent: "The bylaws cover membership, voting, and finances.",
    orgId: "org-1",
    surface: "general" as const,
    permissionScopeKey: buildPermissionScopeKey("org-1", "admin"),
    sourceMessageId: "msg-42",
  };

  it("inserts a row with the correct fields on success", async () => {
    const { writeCacheEntry } = await import("../src/lib/ai/semantic-cache.ts");
    let capturedRow: MockInsertRow | null = null;
    const mock = createMockServiceSupabase({
      insertResult: { data: null, error: null },
      captureInsertRow: (row) => { capturedRow = row; },
    });

    await writeCacheEntry({ ...baseParams, supabase: mock as any });

    assert.ok(capturedRow !== null, "insert should have been called");
    assert.equal(capturedRow.org_id, "org-1");
    assert.equal(capturedRow.surface, "general");
    assert.equal(capturedRow.permission_scope_key, baseParams.permissionScopeKey);
    assert.equal(capturedRow.prompt_normalized, baseParams.normalizedPrompt);
    assert.equal(capturedRow.prompt_hash, baseParams.promptHash);
    assert.equal(capturedRow.response_content, baseParams.responseContent);
    assert.equal(capturedRow.source_message_id, "msg-42");
    assert.ok(capturedRow.expires_at, "expires_at should be set");
    assert.ok(capturedRow.cache_version !== undefined, "cache_version should be set");
  });

  it("invalidates expired conflicting rows before inserting a replacement", async () => {
    const { writeCacheEntry } = await import("../src/lib/ai/semantic-cache.ts");
    let invalidationRow: MockInvalidationRow | null = null;
    const mock = createMockServiceSupabase({
      insertResult: { data: null, error: null },
      captureInvalidationRow: (row) => { invalidationRow = row; },
    });

    await writeCacheEntry({ ...baseParams, supabase: mock as any });

    assert.equal(invalidationRow?.invalidation_reason, "replaced_after_expiry");
    assert.ok(invalidationRow?.invalidated_at, "expired conflicts should be invalidated first");
  });

  it("skips write when responseContent exceeds 16000 chars", async () => {
    const { writeCacheEntry } = await import("../src/lib/ai/semantic-cache.ts");
    let insertCalled = false;
    const mock = createMockServiceSupabase({
      insertResult: { data: null, error: null },
      captureInsertRow: () => { insertCalled = true; },
    });

    await writeCacheEntry({
      ...baseParams,
      responseContent: "x".repeat(16001),
      supabase: mock as any,
    });

    assert.equal(insertCalled, false, "insert should not be called for oversized content");
  });

  it("does not throw on unique constraint violation (code 23505)", async () => {
    const { writeCacheEntry } = await import("../src/lib/ai/semantic-cache.ts");
    const mock = createMockServiceSupabase({
      insertResult: { data: null, error: { code: "23505", message: "duplicate key value" } },
    });

    // Should resolve without throwing
    await assert.doesNotReject(() =>
      writeCacheEntry({ ...baseParams, supabase: mock as any })
    );
  });

  it("does not throw on any other database error", async () => {
    const { writeCacheEntry } = await import("../src/lib/ai/semantic-cache.ts");
    const mock = createMockServiceSupabase({
      insertResult: { data: null, error: { code: "42P01", message: "table does not exist" } },
    });

    await assert.doesNotReject(() =>
      writeCacheEntry({ ...baseParams, supabase: mock as any })
    );
  });

  it("accepts exactly 16000 chars (boundary — should write)", async () => {
    const { writeCacheEntry } = await import("../src/lib/ai/semantic-cache.ts");
    let insertCalled = false;
    const mock = createMockServiceSupabase({
      insertResult: { data: null, error: null },
      captureInsertRow: () => { insertCalled = true; },
    });

    await writeCacheEntry({
      ...baseParams,
      responseContent: "y".repeat(16000),
      supabase: mock as any,
    });

    assert.equal(insertCalled, true, "insert should be called for content of exactly 16000 chars");
  });
});
