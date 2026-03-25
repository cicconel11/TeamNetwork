import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_THREAD_STORAGE_PREFIX,
  buildActiveThreadStorageKey,
  readPersistedActiveThreadId,
  writePersistedActiveThreadId,
  clearPersistedActiveThreadId,
} from "../src/components/ai-assistant/active-thread-storage.ts";

function createStorageStub() {
  const values = new Map<string, string>();

  return {
    values,
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

test("buildActiveThreadStorageKey scopes persisted threads by org and surface", () => {
  assert.equal(
    buildActiveThreadStorageKey("org-1", "general"),
    `${ACTIVE_THREAD_STORAGE_PREFIX}:org-1:general`
  );
  assert.notEqual(
    buildActiveThreadStorageKey("org-1", "general"),
    buildActiveThreadStorageKey("org-1", "members")
  );
});

test("persisted active thread round-trips through storage", () => {
  const storage = createStorageStub();

  writePersistedActiveThreadId(storage, "org-1", "general", "thread-1");

  assert.equal(
    readPersistedActiveThreadId(storage, "org-1", "general"),
    "thread-1"
  );
});

test("persisted active thread does not bleed across surfaces", () => {
  const storage = createStorageStub();

  writePersistedActiveThreadId(storage, "org-1", "general", "thread-1");

  assert.equal(readPersistedActiveThreadId(storage, "org-1", "members"), null);
});

test("clearing a persisted active thread removes only that scoped key", () => {
  const storage = createStorageStub();

  writePersistedActiveThreadId(storage, "org-1", "general", "thread-1");
  writePersistedActiveThreadId(storage, "org-1", "members", "thread-2");

  clearPersistedActiveThreadId(storage, "org-1", "general");

  assert.equal(readPersistedActiveThreadId(storage, "org-1", "general"), null);
  assert.equal(readPersistedActiveThreadId(storage, "org-1", "members"), "thread-2");
});
