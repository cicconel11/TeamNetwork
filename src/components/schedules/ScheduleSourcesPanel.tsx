"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, Input } from "@/components/ui";

type PreviewEvent = {
  external_uid: string;
  title: string;
  start_at: string;
  end_at: string;
  location?: string;
  status?: "confirmed" | "cancelled" | "tentative";
};

type PreviewResponse = {
  vendor: "ics" | "vendorA" | "vendorB" | "generic_html";
  title: string | null;
  eventsPreview: PreviewEvent[];
  maskedUrl: string;
};

type SourceSummary = {
  id: string;
  vendor_id: PreviewResponse["vendor"];
  maskedUrl: string;
  status: "active" | "paused" | "error";
  last_synced_at: string | null;
  last_error: string | null;
  title: string | null;
};

interface ScheduleSourcesPanelProps {
  orgId: string;
  isAdmin: boolean;
}

function formatDateTime(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString();
}

function vendorLabel(vendor: PreviewResponse["vendor"]) {
  switch (vendor) {
    case "ics":
      return "ICS";
    case "vendorA":
      return "Vantage";
    case "vendorB":
      return "Sidearm";
    case "generic_html":
      return "HTML";
    default:
      return "Schedule";
  }
}

function statusVariant(status: SourceSummary["status"]) {
  switch (status) {
    case "active":
      return "success";
    case "paused":
      return "warning";
    case "error":
      return "error";
    default:
      return "muted";
  }
}

export function ScheduleSourcesPanel({ orgId, isAdmin }: ScheduleSourcesPanelProps) {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [connectLoading, setConnectLoading] = useState(false);
  const [syncingSourceId, setSyncingSourceId] = useState<string | null>(null);
  const [updatingSourceId, setUpdatingSourceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const previewDisabled = !url.trim() || previewLoading;

  const refreshSources = useCallback(async () => {
    setLoadingSources(true);
    try {
      const response = await fetch(`/api/schedules/sources?orgId=${orgId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to load sources.");
      }

      setSources(data.sources || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sources.");
    } finally {
      setLoadingSources(false);
    }
  }, [orgId]);

  useEffect(() => {
    refreshSources();
  }, [refreshSources]);

  const handlePreview = async () => {
    if (!url.trim()) {
      setError("Paste a schedule link to preview.");
      return;
    }

    setPreviewLoading(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/schedules/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, url: url.trim() }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to preview schedule.");
      }

      setPreview({
        vendor: data.vendor,
        title: data.title,
        eventsPreview: data.eventsPreview || [],
        maskedUrl: data.maskedUrl,
      });
      setTitle(data.title || "");
      setPreviewUrl(url.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preview schedule.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleConnect = async () => {
    if (!preview || !previewUrl) {
      setError("Preview a schedule before importing.");
      return;
    }

    if (!isAdmin) {
      setError("Only admins can connect schedule sources.");
      return;
    }

    setConnectLoading(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/schedules/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, url: previewUrl, title: title.trim() || undefined }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to import schedule.");
      }

      setNotice("Schedule connected and syncing.");
      setPreview(null);
      setPreviewUrl(null);
      setTitle("");
      setUrl("");
      await refreshSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import schedule.");
    } finally {
      setConnectLoading(false);
    }
  };

  const handleSync = async (sourceId: string) => {
    setSyncingSourceId(sourceId);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/schedules/sources/${sourceId}/sync`, { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to sync schedule.");
      }

      setNotice("Schedule synced.");
      await refreshSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync schedule.");
    } finally {
      setSyncingSourceId(null);
    }
  };

  const handleToggleStatus = async (source: SourceSummary) => {
    if (!isAdmin) {
      setError("Only admins can update schedule sources.");
      return;
    }

    setUpdatingSourceId(source.id);
    setError(null);
    setNotice(null);

    try {
      const nextStatus = source.status === "paused" ? "active" : "paused";
      const response = await fetch(`/api/schedules/sources/${source.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to update schedule source.");
      }

      setNotice(nextStatus === "active" ? "Schedule resumed." : "Schedule paused.");
      await refreshSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update schedule source.");
    } finally {
      setUpdatingSourceId(null);
    }
  };

  const handleRemove = async (sourceId: string) => {
    if (!isAdmin) {
      setError("Only admins can remove schedule sources.");
      return;
    }

    if (!confirm("Remove this schedule source?")) {
      return;
    }

    setUpdatingSourceId(sourceId);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/schedules/sources/${sourceId}`, { method: "DELETE" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to remove schedule source.");
      }

      setNotice("Schedule source removed.");
      await refreshSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove schedule source.");
    } finally {
      setUpdatingSourceId(null);
    }
  };

  const previewEvents = useMemo(() => preview?.eventsPreview || [], [preview]);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">Import Team Schedule</h2>
        <Card className="p-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                label="Paste schedule link"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://athletics.example.com/schedule"
                helperText="Paste a public schedule link or iCal/ICS export (look for “Subscribe” or “iCal” on the athletics site)."
              />
            </div>
            <Button onClick={handlePreview} isLoading={previewLoading} disabled={previewDisabled}>
              Preview
            </Button>
          </div>
          {notice && <p className="text-sm text-foreground">{notice}</p>}
          {error && <p className="text-sm text-error">{error}</p>}
          {!isAdmin && (
            <p className="text-xs text-muted-foreground">Only admins can connect schedule sources for the team.</p>
          )}
        </Card>
      </section>

      {preview && (
        <section>
          <Card className="p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="muted">{vendorLabel(preview.vendor)}</Badge>
              <span className="text-sm text-muted-foreground">{preview.maskedUrl}</span>
            </div>
            <Input
              label="Schedule name (optional)"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
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
              <Button onClick={handleConnect} isLoading={connectLoading}>
                Import + Sync
              </Button>
            )}
          </Card>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">Connected Sources</h2>
        <Card className="p-4">
          {loadingSources ? (
            <p className="text-sm text-muted-foreground">Loading sources...</p>
          ) : sources.length === 0 ? (
            <EmptyState
              title="No sources connected"
              description="Connect a schedule link to keep team events in sync."
            />
          ) : (
            <div className="space-y-3">
              {sources.map((source) => (
                <div
                  key={source.id}
                  className="flex flex-col gap-3 border border-border/60 rounded-xl p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground">{source.title || vendorLabel(source.vendor_id)}</p>
                      <Badge variant={statusVariant(source.status)}>{source.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{source.maskedUrl}</p>
                    <p className="text-xs text-muted-foreground">
                      Last sync: {source.last_synced_at ? formatDateTime(source.last_synced_at) : "Never"}
                    </p>
                    {source.status === "error" && source.last_error && (
                      <p className="text-xs text-error">{source.last_error}</p>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        isLoading={syncingSourceId === source.id}
                        onClick={() => handleSync(source.id)}
                      >
                        Sync now
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        isLoading={updatingSourceId === source.id}
                        onClick={() => handleToggleStatus(source)}
                      >
                        {source.status === "paused" ? "Resume" : "Pause"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        isLoading={updatingSourceId === source.id}
                        onClick={() => handleRemove(source.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
