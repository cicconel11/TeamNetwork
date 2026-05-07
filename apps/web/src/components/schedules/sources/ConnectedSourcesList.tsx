"use client";

import { EmptyState } from "@/components/ui";
import { SourceCard } from "./SourceCard";
import type { SourceSummary } from "@/hooks";

type ConnectedSourcesListProps = {
  sources: SourceSummary[];
  loadingSources: boolean;
  isAdmin: boolean;
  syncingSourceId: string | null;
  pausingSourceId: string | null;
  removingSourceId: string | null;
  onSync: (sourceId: string) => void;
  onToggleStatus: (source: SourceSummary) => void;
  onRemove: (sourceId: string) => void;
};

function BoltIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M11.983 1.907a.75.75 0 00-1.292-.657l-8.5 9.5A.75.75 0 002.75 12h6.572l-1.305 6.093a.75.75 0 001.292.657l8.5-9.5A.75.75 0 0017.25 8h-6.572l1.305-6.093z" />
    </svg>
  );
}

function CalendarPlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" />
    </svg>
  );
}

export function ConnectedSourcesList({
  sources,
  loadingSources,
  isAdmin,
  syncingSourceId,
  pausingSourceId,
  removingSourceId,
  onSync,
  onToggleStatus,
  onRemove,
}: ConnectedSourcesListProps) {
  return (
    <section className="space-y-4">
      {/* Section header with icon and count */}
      <div className="flex items-center gap-2">
        <BoltIcon className="w-5 h-5 text-org-secondary" />
        <h2 className="text-lg font-display font-semibold text-foreground">
          Connected Sources
        </h2>
        {!loadingSources && sources.length > 0 && (
          <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground rounded-full">
            {sources.length}
          </span>
        )}
      </div>

      {/* Content */}
      {loadingSources ? (
        <div className="flex items-center gap-3 p-4 bg-muted/30 rounded-xl">
          <div className="animate-spin w-5 h-5 border-2 border-muted-foreground/30 border-t-org-secondary rounded-full" />
          <p className="text-sm text-muted-foreground">Loading sources...</p>
        </div>
      ) : sources.length === 0 ? (
        <div className="bg-gradient-to-b from-muted/50 to-transparent rounded-xl p-8">
          <EmptyState
            icon={<CalendarPlusIcon className="w-12 h-12" />}
            title="No sources connected"
            description="Connect a schedule link above to keep team events in sync automatically."
          />
        </div>
      ) : (
        <div className="space-y-3 stagger-children">
          {sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              isAdmin={isAdmin}
              syncingSourceId={syncingSourceId}
              pausingSourceId={pausingSourceId}
              removingSourceId={removingSourceId}
              onSync={onSync}
              onToggleStatus={onToggleStatus}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </section>
  );
}
