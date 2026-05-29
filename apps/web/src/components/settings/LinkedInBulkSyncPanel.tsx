"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { LinkedInIcon } from "@/components/shared/LinkedInIcon";
import { showFeedback } from "@/lib/feedback/show-feedback";

interface ProgressCounts {
  pending: number;
  syncing: number;
  enriched: number;
  failed: number;
  none: number;
}

interface LinkedInBulkSyncPanelProps {
  orgId: string;
}

export function LinkedInBulkSyncPanel({ orgId }: LinkedInBulkSyncPanelProps) {
  const [syncing, setSyncing] = useState(false);
  const [counts, setCounts] = useState<ProgressCounts | null>(null);

  const loadProgress = useCallback(async () => {
    if (!orgId) return;
    try {
      const res = await fetch(`/api/organizations/${orgId}/linkedin/bulk-sync`);
      if (!res.ok) return;
      const data = (await res.json()) as { counts?: ProgressCounts };
      if (data.counts) setCounts(data.counts);
    } catch {
      // Non-fatal — progress is best-effort.
    }
  }, [orgId]);

  useEffect(() => {
    void loadProgress();
  }, [loadProgress]);

  const handleSync = async () => {
    if (!orgId) return;
    setSyncing(true);
    try {
      const res = await fetch(`/api/organizations/${orgId}/linkedin/bulk-sync`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? "Failed to start bulk sync");
      }
      showFeedback(
        (data as { message?: string }).message ?? "LinkedIn bulk sync started.",
        "success",
        { duration: 6000 },
      );
      await loadProgress();
    } catch (err) {
      showFeedback(err instanceof Error ? err.message : "Failed to start bulk sync", "error", { duration: 6000 });
    } finally {
      setSyncing(false);
    }
  };

  const withUrl = counts
    ? counts.pending + counts.syncing + counts.enriched + counts.failed + counts.none
    : null;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LinkedInIcon />
          <p className="font-medium text-foreground">LinkedIn enrichment</p>
        </div>
        {counts && counts.syncing > 0 && <Badge variant="primary">{counts.syncing} syncing</Badge>}
      </div>

      <p className="text-sm text-muted-foreground">
        Enrich every member, alumni, and parent who has a LinkedIn URL on file — pulling job
        title, company, education, skills, and more. Runs in the background; profiles update as
        each one completes.
      </p>

      {counts && withUrl !== null && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="muted">{withUrl} with a URL</Badge>
          {counts.enriched > 0 && <Badge variant="success">{counts.enriched} synced</Badge>}
          {counts.syncing > 0 && <Badge variant="primary">{counts.syncing} syncing</Badge>}
          {counts.pending > 0 && <Badge variant="muted">{counts.pending} pending</Badge>}
          {counts.failed > 0 && <Badge variant="error">{counts.failed} failed</Badge>}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={handleSync} isLoading={syncing} disabled={syncing}>
          Sync all LinkedIn profiles
        </Button>
        <button
          type="button"
          onClick={loadProgress}
          disabled={syncing}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          Refresh status
        </button>
      </div>
    </Card>
  );
}
