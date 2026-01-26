"use client";

import { Button } from "@/components/ui";
import { vendorLabel } from "../shared/VendorBadge";
import { SyncStatusBadge } from "../shared/SyncStatusBadge";
import type { SourceSummary, SourceStatus } from "@/hooks";

type SourceCardProps = {
  source: SourceSummary;
  isAdmin: boolean;
  syncingSourceId: string | null;
  updatingSourceId: string | null;
  onSync: (sourceId: string) => void;
  onToggleStatus: (source: SourceSummary) => void;
  onRemove: (sourceId: string) => void;
};

function formatDateTime(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString();
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.25A2.75 2.75 0 0118 6.75v8.5A2.75 2.75 0 0115.25 18H4.75A2.75 2.75 0 012 15.25v-8.5A2.75 2.75 0 014.75 4H5V2.75A.75.75 0 015.75 2zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75z" clipRule="evenodd" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm-11.23-3.47a.75.75 0 00-1.449.39A7 7 0 0014.345 11.5l.31.31v-2.43a.75.75 0 011.5 0v4.242a.75.75 0 01-.75.75H11.16a.75.75 0 110-1.5h2.433l-.311-.31a5.5 5.5 0 01-9.201-2.466.75.75 0 00.001-.126z" clipRule="evenodd" />
    </svg>
  );
}

function statusBorderColor(status: SourceStatus): string {
  switch (status) {
    case "active":
      return "border-l-success";
    case "paused":
      return "border-l-warning";
    case "error":
      return "border-l-error";
    default:
      return "border-l-muted-foreground";
  }
}

export function SourceCard({
  source,
  isAdmin,
  syncingSourceId,
  updatingSourceId,
  onSync,
  onToggleStatus,
  onRemove,
}: SourceCardProps) {
  const borderColor = statusBorderColor(source.status);

  return (
    <div
      className={`
        relative flex flex-col gap-3 rounded-xl bg-card
        border border-border/60 border-l-4 ${borderColor}
        p-4 sm:flex-row sm:items-center sm:justify-between
        transition-all duration-200
        hover:shadow-md hover:border-l-[6px]
      `}
    >
      <div className="flex items-start gap-3 min-w-0">
        {/* Calendar icon */}
        <div className="p-2 bg-muted rounded-lg flex-shrink-0">
          <CalendarIcon className="w-5 h-5 text-muted-foreground" />
        </div>

        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-foreground truncate">
              {source.title || vendorLabel(source.vendor_id)}
            </p>
            <SyncStatusBadge status={source.status} variant="dot" />
          </div>
          <p className="text-sm text-muted-foreground truncate">{source.maskedUrl}</p>
          <p className="text-xs text-muted-foreground">
            Last sync: {source.last_synced_at ? formatDateTime(source.last_synced_at) : "Never"}
          </p>
          {source.status === "error" && source.last_error && (
            <p className="text-xs text-error mt-1 bg-error/5 rounded px-2 py-1">{source.last_error}</p>
          )}
        </div>
      </div>

      {isAdmin && (
        <div className="flex items-center gap-2 flex-shrink-0 pl-10 sm:pl-0">
          {/* Sync button - always visible */}
          <Button
            variant="secondary"
            size="sm"
            isLoading={syncingSourceId === source.id}
            onClick={() => onSync(source.id)}
            className="gap-1.5"
          >
            <RefreshIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Sync</span>
          </Button>
          {/* Pause/Resume button */}
          <Button
            variant="ghost"
            size="sm"
            isLoading={updatingSourceId === source.id}
            onClick={() => onToggleStatus(source)}
          >
            {source.status === "paused" ? "Resume" : "Pause"}
          </Button>
          {/* Remove button */}
          <Button
            variant="ghost"
            size="sm"
            isLoading={updatingSourceId === source.id}
            onClick={() => onRemove(source.id)}
            className="text-muted-foreground hover:text-error"
          >
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}
