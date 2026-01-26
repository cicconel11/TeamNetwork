"use client";

import { Button, Card, EmptyState, Input } from "@/components/ui";
import { VendorBadge } from "../shared";
import type { PreviewEvent, PreviewResponse } from "@/hooks";

type SchedulePreviewCardProps = {
  preview: PreviewResponse;
  previewEvents: PreviewEvent[];
  title: string;
  onTitleChange: (title: string) => void;
  onConnect: () => void;
  connectLoading: boolean;
  isAdmin: boolean;
};

export function SchedulePreviewCard({
  preview,
  previewEvents,
  title,
  onTitleChange,
  onConnect,
  connectLoading,
  isAdmin,
}: SchedulePreviewCardProps) {
  return (
    <section>
      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <VendorBadge vendor={preview.vendor} />
          <span className="text-sm text-muted-foreground">{preview.maskedUrl}</span>
        </div>
        <Input
          label="Schedule name (optional)"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder={preview.title || "Team schedule"}
        />
        {previewEvents.length === 0 ? (
          <EmptyState
            title="No events found"
            description="We could not detect upcoming events from that link."
          />
        ) : (
          <div className="divide-y divide-border/60">
            {previewEvents.map((event) => (
              <div key={event.external_uid} className="py-3">
                <p className="font-medium text-foreground">{event.title}</p>
                <p className="text-sm text-muted-foreground">
                  {new Date(event.start_at).toLocaleString()} – {new Date(event.end_at).toLocaleString()}
                </p>
                {event.location && (
                  <p className="text-sm text-muted-foreground">{event.location}</p>
                )}
              </div>
            ))}
          </div>
        )}
        {isAdmin && (
          <Button onClick={onConnect} isLoading={connectLoading}>
            Import + Sync
          </Button>
        )}
      </Card>
    </section>
  );
}
