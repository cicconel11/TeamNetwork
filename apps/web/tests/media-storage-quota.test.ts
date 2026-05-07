import test from "node:test";
import assert from "node:assert/strict";
import { checkStorageQuota } from "@/lib/media/storage-quota";

type MockResult = { data: unknown; error: unknown };

interface MockOpts {
  subscription?: MockResult;
  items?: MockResult;
  uploads?: MockResult;
}

function makeClient(opts: MockOpts) {
  const handlers: Record<string, MockResult> = {
    organization_subscriptions: opts.subscription ?? { data: { media_storage_quota_bytes: 1000 }, error: null },
    media_items: opts.items ?? { data: [], error: null },
    media_uploads: opts.uploads ?? { data: [], error: null },
  };

  function buildSubChain(table: string) {
    const result = handlers[table];
    return {
      select() { return this; },
      eq() { return this; },
      maybeSingle() { return Promise.resolve(result); },
    };
  }

  function buildUsageChain(table: string) {
    const result = handlers[table];
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      is() { return chain; },
      in() { return Promise.resolve(result); },
    };
    return chain;
  }

  return {
    from(table: string) {
      if (table === "organization_subscriptions") return buildSubChain(table);
      return buildUsageChain(table);
    },
  } as never;
}

test("checkStorageQuota: under quota returns ok", async () => {
  const client = makeClient({
    subscription: { data: { media_storage_quota_bytes: 1000 }, error: null },
    items: {
      data: [
        { file_size_bytes: 100, preview_file_size_bytes: 25 },
        { file_size_bytes: 200, preview_file_size_bytes: null },
      ],
      error: null,
    },
    uploads: { data: [{ file_size: 50, preview_file_size: 10 }], error: null },
  });
  const result = await checkStorageQuota(client, "org-1", 100, 20);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.usedBytes, 385);
    assert.equal(result.quotaBytes, 1000);
    assert.equal(result.remainingBytes, 615);
  }
});

test("checkStorageQuota: incoming pushes over quota returns over_quota", async () => {
  const client = makeClient({
    subscription: { data: { media_storage_quota_bytes: 1000 }, error: null },
    items: { data: [{ file_size_bytes: 900 }], error: null },
    uploads: { data: [], error: null },
  });
  const result = await checkStorageQuota(client, "org-1", 200);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "over_quota");
    assert.equal(result.usedBytes, 900);
    assert.equal(result.quotaBytes, 1000);
  }
});

test("checkStorageQuota: exactly at quota with incoming bytes is over", async () => {
  const client = makeClient({
    subscription: { data: { media_storage_quota_bytes: 1000 }, error: null },
    items: { data: [{ file_size_bytes: 1000 }], error: null },
    uploads: { data: [], error: null },
  });
  const result = await checkStorageQuota(client, "org-1", 1);
  assert.equal(result.ok, false);
});

test("checkStorageQuota: NULL quota = unlimited (enterprise) always ok", async () => {
  const client = makeClient({
    subscription: { data: { media_storage_quota_bytes: null }, error: null },
    items: { data: [{ file_size_bytes: 999_999_999, preview_file_size_bytes: 321 }], error: null },
    uploads: { data: [], error: null },
  });
  const result = await checkStorageQuota(client, "org-1", 1_000_000);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.usedBytes, 1_000_000_320);
    assert.equal(result.quotaBytes, null);
    assert.equal(result.remainingBytes, null);
  }
});

test("checkStorageQuota: subscription lookup error fails closed", async () => {
  const client = makeClient({
    subscription: { data: null, error: { message: "boom" } },
  });
  const result = await checkStorageQuota(client, "org-1", 100);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "lookup_failed");
});

test("checkStorageQuota: items query error fails closed", async () => {
  const client = makeClient({
    subscription: { data: { media_storage_quota_bytes: 1000 }, error: null },
    items: { data: null, error: { message: "boom" } },
    uploads: { data: [], error: null },
  });
  const result = await checkStorageQuota(client, "org-1", 100);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "lookup_failed");
});

test("checkStorageQuota: missing subscription row treated as unlimited (default applied at DB layer)", async () => {
  // maybeSingle() returns null data with no error when row missing.
  // Helper sees quota=null and treats as unlimited; the column default
  // (5 GB) is applied at INSERT time on the subscription row.
  const client = makeClient({
    subscription: { data: null, error: null },
    items: { data: [], error: null },
    uploads: { data: [], error: null },
  });
  const result = await checkStorageQuota(client, "org-1", 100);
  assert.equal(result.ok, true);
});
