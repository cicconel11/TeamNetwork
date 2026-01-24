"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, Input } from "@/components/ui";

const VISIBLE_DAYS = 30;

type FeedSummary = {
  id: string;
  maskedUrl: string;
  status: "active" | "error" | "disabled";
  last_synced_at: string | null;
  last_error?: string | null;
  provider?: string | null;
};

type CalendarEventSummary = {
  id: string;
  title: string | null;
  start_at: string;
  end_at: string | null;
  location: string | null;
  feed_id: string;
};

function formatDateTime(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  return date.toLocaleString();
}

function formatEventTime(startAt: string, endAt: string | null) {
  const start = new Date(startAt);
  const startLabel = start.toLocaleString();

  if (!endAt) {
    return startLabel;
  }

  const end = new Date(endAt);
  const endLabel = end.toLocaleString();
  return `${startLabel} - ${endLabel}`;
}

function statusVariant(status: FeedSummary["status"]) {
  switch (status) {
    case "active":
      return "success";
    case "error":
      return "error";
    case "disabled":
      return "warning";
    default:
      return "muted";
  }
}

export function CalendarSyncPanel() {
  const [feedUrl, setFeedUrl] = useState("");
  const [feeds, setFeeds] = useState<FeedSummary[]>([]);
  const [events, setEvents] = useState<CalendarEventSummary[]>([]);
  const [loadingFeeds, setLoadingFeeds] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [connectLoading, setConnectLoading] = useState(false);
  const [syncingFeedId, setSyncingFeedId] = useState<string | null>(null);
  const [disconnectingFeedId, setDisconnectingFeedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const dateRange = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setDate(end.getDate() + VISIBLE_DAYS);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }, []);

  const refreshFeeds = useCallback(async () => {
    setLoadingFeeds(true);
    try {
      const response = await fetch("/api/calendar/feeds");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to load feeds.");
      }

      setFeeds(data.feeds || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load feeds.");
    } finally {
      setLoadingFeeds(false);
    }
  }, []);

  const refreshEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const params = new URLSearchParams({
        start: dateRange.start.toISOString(),
        end: dateRange.end.toISOString(),
      });
      const response = await fetch(`/api/calendar/events?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to load events.");
      }

      setEvents(data.events || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events.");
    } finally {
      setLoadingEvents(false);
    }
  }, [dateRange]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshFeeds(), refreshEvents()]);
  }, [refreshFeeds, refreshEvents]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const handleConnect = async () => {
    if (!feedUrl.trim()) {
      setError("Paste a calendar link to connect.");
      return;
    }

    setError(null);
    setNotice(null);
    setConnectLoading(true);

    try {
      const response = await fetch("/api/calendar/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedUrl: feedUrl.trim(), provider: "ics" }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to connect feed.");
      }

      setFeedUrl("");
      setNotice("Schedule connected. We will keep it in sync.");
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect feed.");
    } finally {
      setConnectLoading(false);
    }
  };

  const handleSyncNow = async (feedId: string) => {
    setError(null);
    setNotice(null);
    setSyncingFeedId(feedId);

    try {
      const response = await fetch(`/api/calendar/feeds/${feedId}/sync`, {
        method: "POST",
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to sync feed.");
      }

      setNotice("Schedule synced.");
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync feed.");
    } finally {
      setSyncingFeedId(null);
    }
  };

  const handleDisconnect = async (feedId: string) => {
    if (!confirm("Disconnect this calendar feed?")) {
      return;
    }

    setError(null);
    setNotice(null);
    setDisconnectingFeedId(feedId);

    try {
      const response = await fetch(`/api/calendar/feeds/${feedId}`, {
        method: "DELETE",
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to disconnect feed.");
      }

      setNotice("Schedule disconnected.");
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect feed.");
    } finally {
      setDisconnectingFeedId(null);
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">Sync Schedule</h2>
        <Card className="p-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                label="Paste calendar link (ICS)"
                value={feedUrl}
                onChange={(event) => setFeedUrl(event.target.value)}
                placeholder="https://school.example.edu/calendar.ics"
                helperText="Works with Schoology, Brightspace, Blackboard, Moodle, Canvas, and more."
              />
            </div>
            <Button onClick={handleConnect} isLoading={connectLoading}>
              Add schedule via calendar link (ICS)
            </Button>
          </div>
          {notice && <p className="text-sm text-foreground">{notice}</p>}
          {error && <p className="text-sm text-error">{error}</p>}
        </Card>
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">Manage Schedules</h2>
        </div>
        <Card className="p-4">
          {loadingFeeds ? (
            <p className="text-sm text-muted-foreground">Loading schedules...</p>
          ) : feeds.length === 0 ? (
            <EmptyState
              title="No connected schedules"
              description="Connect a calendar feed to keep your schedule in sync."
            />
          ) : (
            <div className="space-y-3">
              {feeds.map((feed) => (
                <div
                  key={feed.id}
                  className="flex flex-col gap-3 border border-border/60 rounded-xl p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground">ICS Feed</p>
                      <Badge variant={statusVariant(feed.status)}>{feed.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{feed.maskedUrl}</p>
                    <p className="text-xs text-muted-foreground">
                      Last sync: {feed.last_synced_at ? formatDateTime(feed.last_synced_at) : "Never"}
                    </p>
                    {feed.status === "error" && feed.last_error && (
                      <p className="text-xs text-error">{feed.last_error}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      isLoading={syncingFeedId === feed.id}
                      onClick={() => handleSyncNow(feed.id)}
                    >
                      Sync now
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      isLoading={disconnectingFeedId === feed.id}
                      onClick={() => handleDisconnect(feed.id)}
                    >
                      Disconnect
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">Upcoming Events</h2>
        <Card className="p-4">
          {loadingEvents ? (
            <p className="text-sm text-muted-foreground">Loading events...</p>
          ) : events.length === 0 ? (
            <EmptyState
              title="No events yet"
              description="Once your calendar feed syncs, events will appear here."
            />
          ) : (
            <div className="divide-y divide-border/60">
              {events.map((event) => (
                <div key={event.id} className="py-3">
                  <p className="font-medium text-foreground">{event.title || "Untitled event"}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatEventTime(event.start_at, event.end_at)}
                  </p>
                  {event.location && (
                    <p className="text-sm text-muted-foreground">{event.location}</p>
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
