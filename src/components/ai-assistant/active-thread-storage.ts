export const ACTIVE_THREAD_STORAGE_PREFIX = "ai-panel-active-thread";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function buildActiveThreadStorageKey(orgId: string, surface: string): string {
  return `${ACTIVE_THREAD_STORAGE_PREFIX}:${orgId}:${surface}`;
}

export function readPersistedActiveThreadId(
  storage: StorageLike,
  orgId: string,
  surface: string
): string | null {
  return storage.getItem(buildActiveThreadStorageKey(orgId, surface));
}

export function writePersistedActiveThreadId(
  storage: StorageLike,
  orgId: string,
  surface: string,
  threadId: string
): void {
  storage.setItem(buildActiveThreadStorageKey(orgId, surface), threadId);
}

export function clearPersistedActiveThreadId(
  storage: StorageLike,
  orgId: string,
  surface: string
): void {
  storage.removeItem(buildActiveThreadStorageKey(orgId, surface));
}
