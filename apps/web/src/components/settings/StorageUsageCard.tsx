"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Badge, Card } from "@/components/ui";

interface StorageStats {
  total_bytes: number;
  quota_bytes: number | null;
  usage_percent: number;
  over_quota: boolean;
  media_items_count: number;
  media_uploads_count: number;
}

interface StorageUsageCardProps {
  orgId: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

export function StorageUsageCard({ orgId }: StorageUsageCardProps) {
  const supabase = useMemo(() => createClient(), []);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      const { data, error } = await supabase.rpc("get_media_storage_stats", {
        p_org_id: orgId,
      });
      if (!error && data && typeof data === "object" && "allowed" in (data as Record<string, unknown>) && (data as Record<string, unknown>).allowed) {
        const d = data as Record<string, unknown>;
        setStorageStats({
          total_bytes: (d.total_bytes as number) ?? 0,
          quota_bytes: (d.quota_bytes as number) ?? null,
          usage_percent: (d.usage_percent as number) ?? 0,
          over_quota: (d.over_quota as boolean) ?? false,
          media_items_count: (d.media_items_count as number) ?? 0,
          media_uploads_count: (d.media_uploads_count as number) ?? 0,
        });
      }
    };

    fetchStats();
  }, [orgId, supabase]);

  if (!storageStats) return null;

  const barColor = storageStats.usage_percent > 90
    ? "bg-red-500"
    : storageStats.usage_percent > 80
      ? "bg-yellow-500"
      : "bg-green-500";

  return (
    <Card className="org-settings-card p-5 space-y-4 opacity-0 translate-y-2 lg:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-foreground">Media storage usage</p>
          <p className="text-sm text-muted-foreground">
            Storage consumed by gallery items and feature uploads.
          </p>
        </div>
        <Badge variant={storageStats.over_quota || storageStats.usage_percent > 90 ? "warning" : "muted"}>
          {storageStats.quota_bytes === null ? "Unlimited" : `${Math.round(storageStats.usage_percent)}%`}
        </Badge>
      </div>

      {storageStats.quota_bytes !== null && (
        <div className="space-y-2">
          <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${Math.min(storageStats.usage_percent, 100)}%` }}
            />
          </div>
          <p className="text-sm text-foreground">
            {formatBytes(storageStats.total_bytes)} of {formatBytes(storageStats.quota_bytes)} used
          </p>
        </div>
      )}

      {storageStats.quota_bytes === null && (
        <p className="text-sm text-foreground">
          {formatBytes(storageStats.total_bytes)} used (unlimited plan)
        </p>
      )}

      {storageStats.over_quota && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Storage quota exceeded. Consider removing unused media or upgrading your plan.
        </p>
      )}
      {!storageStats.over_quota && storageStats.usage_percent > 80 && storageStats.quota_bytes !== null && (
        <p className="text-sm text-yellow-600 dark:text-yellow-400">
          Approaching storage limit. Consider removing unused media or upgrading your plan.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        {storageStats.media_items_count} gallery item{storageStats.media_items_count !== 1 ? "s" : ""}, {storageStats.media_uploads_count} feature upload{storageStats.media_uploads_count !== 1 ? "s" : ""}
      </p>
    </Card>
  );
}
