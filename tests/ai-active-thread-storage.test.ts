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

test("buildActiveThreadStorageKey scopes persisted threads by org", () => {
  assert.equal(
    buildActiveThreadStorageKey("org-1"),
    `${ACTIVE_THREAD_STORAGE_PREFIX}:org-1`
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

test("persisted active thread follows the org across surfaces", () => {
  const storage = createStorageStub();

  writePersistedActiveThreadId(storage, "org-1", "general", "thread-1");

  assert.equal(readPersistedActiveThreadId(storage, "org-1", "members"), "thread-1");
});

test("readPersistedActiveThreadId falls back to the legacy surface-scoped key", () => {
  const storage = createStorageStub();
  storage.setItem(`${ACTIVE_THREAD_STORAGE_PREFIX}:org-1:members`, "thread-legacy");

  assert.equal(readPersistedActiveThreadId(storage, "org-1", "members"), "thread-legacy");
});

test("clearing a persisted active thread removes the org-wide and current legacy key", () => {
  const storage = createStorageStub();

  storage.setItem(`${ACTIVE_THREAD_STORAGE_PREFIX}:org-1`, "thread-1");
  storage.setItem(`${ACTIVE_THREAD_STORAGE_PREFIX}:org-1:general`, "thread-legacy-general");
  storage.setItem(`${ACTIVE_THREAD_STORAGE_PREFIX}:org-1:members`, "thread-legacy-members");

  clearPersistedActiveThreadId(storage, "org-1", "general");

  assert.equal(readPersistedActiveThreadId(storage, "org-1", "general"), null);
  assert.equal(storage.getItem(`${ACTIVE_THREAD_STORAGE_PREFIX}:org-1`), null);
  assert.equal(storage.getItem(`${ACTIVE_THREAD_STORAGE_PREFIX}:org-1:general`), null);
  assert.equal(storage.getItem(`${ACTIVE_THREAD_STORAGE_PREFIX}:org-1:members`), "thread-legacy-members");
});

test("writing a persisted active thread upgrades away the matching legacy key", () => {
  const storage = createStorageStub();

  storage.setItem(`${ACTIVE_THREAD_STORAGE_PREFIX}:org-1:general`, "thread-legacy");

  writePersistedActiveThreadId(storage, "org-1", "general", "thread-1");

  assert.equal(storage.getItem(`${ACTIVE_THREAD_STORAGE_PREFIX}:org-1`), "thread-1");
  assert.equal(storage.getItem(`${ACTIVE_THREAD_STORAGE_PREFIX}:org-1:general`), null);
});
