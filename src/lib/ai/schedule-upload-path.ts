/**
 * Verifies that a storage path belongs to the given org and user,
 * preventing path traversal attacks.
 */
export function isOwnedScheduleUploadPath(
  orgId: string,
  userId: string,
  storagePath: string
): boolean {
  const expectedPrefix = `${orgId}/${userId}/`;
  if (!storagePath.startsWith(expectedPrefix)) {
    return false;
  }
  // Prevent path traversal via ".." in the remaining path segment
  return !storagePath.slice(expectedPrefix.length).includes("..");
}
