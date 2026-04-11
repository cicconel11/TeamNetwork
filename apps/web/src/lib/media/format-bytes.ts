/**
 * Format a byte count for display. Picks the largest unit where the value
 * stays >= 1, falling back to "0 B" for empty inputs.
 *
 * Single source of truth for media UIs that show storage usage. Previously
 * defined twice (StorageUsageCard, MediaStorageUsageBar) with subtly
 * different edge-case handling — extracted here to keep them aligned.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  // One decimal for values < 10 in the chosen unit; otherwise round to int.
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
