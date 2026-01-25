"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, Input } from "@/components/ui";

const UPCOMING_DAYS = 30;

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
  all_day: boolean | null;
  location: string | null;
  feed_id?: string | null;
  origin?: "calendar" | "schedule";
};

type FeedScope = "personal" | "org";

type CalendarSyncPanelProps = {
  organizationId: string;
  isAdmin: boolean;
};

function formatDateTime(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  return date.toLocaleString();
}

function formatEventTime(event: CalendarEventSummary) {
  const start = new Date(event.start_at);

  if (event.all_day) {
    return `${start.toLocaleDateString()} (All day)`;
  }

  const startLabel = start.toLocaleString();

  if (!event.end_at) {
    return startLabel;
  }

  const end = new Date(event.end_at);
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

function isLikelyIcsUrl(feedUrl: string) {
  const lower = feedUrl.toLowerCase();
  return lower.includes(".ics") || lower.includes("ical") || lower.includes("calendar");
}

export function CalendarSyncPanel({ organizationId, isAdmin }: CalendarSyncPanelProps) {
  const [feedUrls, setFeedUrls] = useState<Record<FeedScope, string>>({ personal: "", org: "" });
  const [feedScope, setFeedScope] = useState<FeedScope>(isAdmin ? "org" : "personal");
  const [personalFeeds, setPersonalFeeds] = useState<FeedSummary[]>([]);
  const [orgFeeds, setOrgFeeds] = useState<FeedSummary[]>([]);
  const [orgEvents, setOrgEvents] = useState<CalendarEventSummary[]>([]);
  const [loadingPersonalFeeds, setLoadingPersonalFeeds] = useState(true);
  const [loadingOrgFeeds, setLoadingOrgFeeds] = useState(isAdmin);
  const [loadingOrgEvents, setLoadingOrgEvents] = useState(true);
  const [connectingFeed, setConnectingFeed] = useState(false);
  const [syncingFeedId, setSyncingFeedId] = useState<string | null>(null);
  const [disconnectingFeedId, setDisconnectingFeedId] = useState<string | null>(null);
  const [personalError, setPersonalError] = useState<string | null>(null);
  const [personalNotice, setPersonalNotice] = useState<string | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [orgNotice, setOrgNotice] = useState<string | null>(null);
  const [orgEventsError, setOrgEventsError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin && feedScope === "org") {
      setFeedScope("personal");
    }
  }, [feedScope, isAdmin]);

  const dateRange = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setDate(end.getDate() + UPCOMING_DAYS);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }, []);

  const refreshPersonalFeeds = useCallback(async () => {
    setLoadingPersonalFeeds(true);
    setPersonalError(null);
    try {
      const response = await fetch(`/api/calendar/feeds?organizationId=${organizationId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to load feeds.");
      }

      setPersonalFeeds(data.feeds || []);
    } catch (err) {
      setPersonalError(err instanceof Error ? err.message : "Failed to load feeds.");
    } finally {
      setLoadingPersonalFeeds(false);
    }
  }, [organizationId]);

  const refreshOrgFeeds = useCallback(async () => {
    if (!isAdmin) {
      setOrgFeeds([]);
      setLoadingOrgFeeds(false);
      return;
    }

    setLoadingOrgFeeds(true);
    setOrgError(null);
    try {
      const response = await fetch(`/api/calendar/org-feeds?organizationId=${organizationId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to load org feeds.");
      }

      setOrgFeeds(data.feeds || []);
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Failed to load org feeds.");
    } finally {
      setLoadingOrgFeeds(false);
    }
  }, [isAdmin, organizationId]);

  const refreshOrgEvents = useCallback(async () => {
    setLoadingOrgEvents(true);
    setOrgEventsError(null);
    try {
      const params = new URLSearchParams({
        organizationId,
        start: dateRange.start.toISOString(),
        end: dateRange.end.toISOString(),
      });
      const response = await fetch(`/api/calendar/org-events?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to load events.");
      }

      setOrgEvents(data.events || []);
    } catch (err) {
      setOrgEventsError(err instanceof Error ? err.message : "Failed to load events.");
    } finally {
      setLoadingOrgEvents(false);
    }
  }, [dateRange, organizationId]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshPersonalFeeds(), refreshOrgFeeds(), refreshOrgEvents()]);
  }, [refreshPersonalFeeds, refreshOrgFeeds, refreshOrgEvents]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const notifyAvailabilityRefresh = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("calendar:refresh"));
    }
  };

  const handleConnect = async () => {
    const scope = feedScope;
    const rawUrl = feedUrls[scope]?.trim();

    if (!rawUrl) {
      if (scope === "org") {
        setOrgError("Paste a calendar link to connect.");
      } else {
        setPersonalError("Paste a calendar link to connect.");
      }
      return;
    }

    if (scope === "org" && !isAdmin) {
      setOrgError("Only admins can add org calendars.");
      return;
    }

    if (scope === "personal" && !isLikelyIcsUrl(rawUrl)) {
      setPersonalError("Personal calendars must be an iCal/ICS link.");
      return;
    }

    setPersonalError(null);
    setOrgError(null);
    setPersonalNotice(null);
    setOrgNotice(null);
    setConnectingFeed(true);

    try {
      const connectScheduleSource = async () => {
        const response = await fetch("/api/schedules/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId: organizationId, url: rawUrl }),
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.message || "Failed to connect schedule.");
        }

        setFeedUrls((prev) => ({ ...prev, org: "" }));
        setOrgNotice("Org schedule connected and syncing.");
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("schedule:sources:refresh"));
        }
        await refreshOrgEvents();
        notifyAvailabilityRefresh();
      };

      const endpoint = scope === "org" ? "/api/calendar/org-feeds" : "/api/calendar/feeds";
      if (scope === "org" && !isLikelyIcsUrl(rawUrl)) {
        await connectScheduleSource();
        return;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedUrl: rawUrl,
          provider: "ics",
          organizationId,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        const message = data?.message || "Failed to connect feed.";
        if (scope === "org" && message.toLowerCase().includes("ics")) {
          await connectScheduleSource();
          return;
        }
        throw new Error(message);
      }

      setFeedUrls((prev) => ({ ...prev, [scope]: "" }));
      if (scope === "org") {
        setOrgNotice("Org calendar connected. Everyone will see upcoming events.");
      } else {
        setPersonalNotice("Schedule connected. We will keep it in sync.");
      }

      await refreshAll();
      notifyAvailabilityRefresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect feed.";
      if (scope === "org") {
        setOrgError(message);
      } else {
        setPersonalError(message);
      }
    } finally {
      setConnectingFeed(false);
    }
  };

  const handleSyncNow = async (feedId: string, scope: FeedScope) => {
    setPersonalError(null);
    setOrgError(null);
    setPersonalNotice(null);
    setOrgNotice(null);
    setSyncingFeedId(feedId);

    try {
      const endpoint = scope === "org"
        ? `/api/calendar/org-feeds/${feedId}/sync`
        : `/api/calendar/feeds/${feedId}/sync`;
      const response = await fetch(endpoint, { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to sync feed.");
      }

      if (scope === "org") {
        setOrgNotice("Org calendar synced.");
      } else {
        setPersonalNotice("Schedule synced.");
      }

      await refreshAll();
      notifyAvailabilityRefresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to sync feed.";
      if (scope === "org") {
        setOrgError(message);
      } else {
        setPersonalError(message);
      }
    } finally {
      setSyncingFeedId(null);
    }
  };

  const handleDisconnect = async (feedId: string, scope: FeedScope) => {
    if (!confirm("Disconnect this calendar feed?")) {
      return;
    }

    setPersonalError(null);
    setOrgError(null);
    setPersonalNotice(null);
    setOrgNotice(null);
    setDisconnectingFeedId(feedId);

    try {
      const endpoint = scope === "org"
        ? `/api/calendar/org-feeds/${feedId}`
        : `/api/calendar/feeds/${feedId}`;
      const response = await fetch(endpoint, { method: "DELETE" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to disconnect feed.");
      }

      if (scope === "org") {
        setOrgNotice("Org calendar disconnected.");
      } else {
        setPersonalNotice("Schedule disconnected.");
      }

      await refreshAll();
      notifyAvailabilityRefresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to disconnect feed.";
      if (scope === "org") {
        setOrgError(message);
      } else {
        setPersonalError(message);
      }
    } finally {
      setDisconnectingFeedId(null);
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">Sync Schedule</h2>
        <Card className="p-4 space-y-4">
          {isAdmin ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex items-center rounded-lg border border-border bg-muted/30 p-1">
                <button
                  type="button"
                  onClick={() => setFeedScope("personal")}
                  aria-pressed={feedScope === "personal"}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                    feedScope === "personal"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Personal
                </button>
                <button
                  type="button"
                  onClick={() => setFeedScope("org")}
                  aria-pressed={feedScope === "org"}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                    feedScope === "org"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Organizational
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Org calendars are admin-only.</p>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                label={feedScope === "org" ? "Paste org calendar link" : "Paste calendar link (ICS)"}
                value={feedUrls[feedScope]}
                onChange={(event) => {
                  const value = event.target.value;
                  setFeedUrls((prev) => ({ ...prev, [feedScope]: value }));
                  if (feedScope === "org") {
                    setOrgError(null);
                    setOrgNotice(null);
                  } else {
                    setPersonalError(null);
                    setPersonalNotice(null);
                  }
                }}
                placeholder={feedScope === "org" ? "https://calendar.example.com/team.ics" : "https://school.example.edu/calendar.ics"}
                helperText={
                  feedScope === "org"
                    ? "Use a shared org calendar link. If it's not iCal/ICS, we will try approved schedule sources."
                    : "Works with Canvas, Schoology, Brightspace, Blackboard, Moodle, Google Calendar (public links), and more."
                }
              />
            </div>
            <Button onClick={handleConnect} isLoading={connectingFeed} disabled={feedScope === "org" && !isAdmin}>
              {feedScope === "org" ? "Add org calendar link" : "Add calendar link"}
            </Button>
          </div>
          {feedScope === "org"
            ? orgNotice && <p className="text-sm text-foreground">{orgNotice}</p>
            : personalNotice && <p className="text-sm text-foreground">{personalNotice}</p>}
          {feedScope === "org"
            ? orgError && <p className="text-sm text-error">{orgError}</p>
            : personalError && <p className="text-sm text-error">{personalError}</p>}
        </Card>
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">
            {feedScope === "org" ? "Manage Org Calendars" : "Manage My Schedules"}
          </h2>
        </div>
        <Card className="p-4">
          {!isAdmin && feedScope === "org" ? (
            <EmptyState
              title="Org calendars are admin-only"
              description="Ask an admin to connect a shared org calendar."
            />
          ) : (feedScope === "org" ? loadingOrgFeeds : loadingPersonalFeeds) ? (
            <p className="text-sm text-muted-foreground">Loading schedules...</p>
          ) : (feedScope === "org" ? orgFeeds : personalFeeds).length === 0 ? (
            <EmptyState
              title={`No connected ${feedScope === "org" ? "org calendars" : "schedules"}`}
              description={
                feedScope === "org"
                  ? "Connect a shared calendar to show upcoming org events."
                  : "Connect a calendar feed to keep your availability in sync."
              }
            />
          ) : (
            <div className="space-y-3">
              {(feedScope === "org" ? orgFeeds : personalFeeds).map((feed) => (
                <div
                  key={feed.id}
                  className="flex flex-col gap-3 border border-border/60 rounded-xl p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground">
                        {feedScope === "org" ? "Org ICS Feed" : "ICS Feed"}
                      </p>
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
                      onClick={() => handleSyncNow(feed.id, feedScope)}
                    >
                      Sync now
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      isLoading={disconnectingFeedId === feed.id}
                      onClick={() => handleDisconnect(feed.id, feedScope)}
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
        <h2 className="text-lg font-semibold text-foreground mb-4">Upcoming Org Events</h2>
        <Card className="p-4">
          {loadingOrgEvents ? (
            <p className="text-sm text-muted-foreground">Loading events...</p>
          ) : orgEventsError ? (
            <p className="text-sm text-error">{orgEventsError}</p>
          ) : orgEvents.length === 0 ? (
            <EmptyState
              title="No upcoming events"
              description="Org events will appear here once an admin connects a calendar."
            />
          ) : (
            <div className="divide-y divide-border/60">
              {orgEvents.map((event) => (
                <div key={event.id} className="py-3">
                  <p className="font-medium text-foreground">{event.title || "Untitled event"}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatEventTime(event)}
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
