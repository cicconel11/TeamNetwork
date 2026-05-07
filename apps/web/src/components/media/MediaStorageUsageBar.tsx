"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { formatBytes } from "@/lib/media/format-bytes";

interface MediaStorageUsageBarProps {
  orgId: string;
  isAdmin: boolean;
}

interface StorageStats {
  allowed: boolean;
  total_bytes?: number;
  quota_bytes?: number | null;
  usage_percent?: number;
  over_quota?: boolean;
}

/**
 * Fixed-position bottom-left chip showing org media storage usage.
 *
 * Visibility is admin-only — both via the `isAdmin` prop (skips the fetch
 * entirely) and via the API at /api/media/storage-stats which enforces the
 * same gate server-side. Aggregate org storage is treated as operational
 * data, so non-admins see nothing.
 *
 * State bands:
 *   <75%  neutral
 *   75-90% amber
 *   >=90%  red
 *   over_quota: red + explicit "Quota exceeded" line
 *   unlimited (enterprise): show used only, no bar, no percent
 */
export function MediaStorageUsageBar({ orgId, isAdmin }: MediaStorageUsageBarProps) {
  const tStorage = useTranslations("media.storage");
  const [stats, setStats] = useState<StorageStats | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/media/storage-stats?orgId=${encodeURIComponent(orgId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as StorageStats;
        if (!cancelled) setStats(data);
      } catch {
        // Soft-fail: chip is informational, never block the page.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, isAdmin]);

  if (!isAdmin || !stats || !stats.allowed) return null;

  const used = stats.total_bytes ?? 0;
  const quota = stats.quota_bytes ?? null;
  const isUnlimited = quota === null;
  const percent = stats.usage_percent ?? 0;
  const clampedPercent = Math.min(100, Math.max(0, percent));
  const overQuota = stats.over_quota === true;
  const usedLabel = isUnlimited
    ? tStorage("usedUnlimited", { used: formatBytes(used) })
    : tStorage("usedOf", {
        used: formatBytes(used),
        quota: formatBytes(quota!),
      });
  const ariaLabel = isUnlimited
    ? tStorage("ariaUsedUnlimited", { used: formatBytes(used) })
    : tStorage("ariaUsedOf", {
        used: formatBytes(used),
        quota: formatBytes(quota!),
        percent: percent.toFixed(1),
      });

  // Color band selection — red takes precedence over amber.
  let barColor = "bg-muted-foreground/60";
  let textColor = "text-muted-foreground";
  let borderTone = "border-border";
  if (overQuota || percent >= 90) {
    barColor = "bg-red-500";
    textColor = "text-red-600 dark:text-red-400";
    borderTone = "border-red-500/40";
  } else if (percent >= 75) {
    barColor = "bg-amber-500";
    textColor = "text-amber-600 dark:text-amber-400";
    borderTone = "border-amber-500/40";
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      className={`fixed bottom-24 left-4 right-4 sm:bottom-4 sm:left-[17rem] sm:right-auto z-20 sm:z-40 w-auto max-w-[calc(100vw-2rem)] sm:w-[260px] sm:max-w-[260px] rounded-lg border ${borderTone} bg-card/95 backdrop-blur-sm px-4 py-3 shadow-lg pointer-events-auto`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {tStorage("title")}
        </span>
        {!isUnlimited && (
          <span className={`text-xs font-medium ${textColor}`}>
            {percent.toFixed(0)}%
          </span>
        )}
      </div>

      {isUnlimited ? (
        <p className="text-sm text-foreground">{usedLabel}</p>
      ) : (
        <>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mb-2">
            <div
              className={`h-full ${barColor} transition-all duration-300`}
              style={{ width: `${clampedPercent}%` }}
            />
          </div>
          <p className="text-xs text-foreground">{usedLabel}</p>
          {overQuota && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              {tStorage("quotaExceeded")}
            </p>
          )}
          {!overQuota && percent >= 75 && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              {tStorage("approachingLimit")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
