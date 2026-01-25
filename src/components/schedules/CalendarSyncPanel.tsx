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
  feed_id: string;
};

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

export function CalendarSyncPanel({ organizationId, isAdmin }: CalendarSyncPanelProps) {
  const [personalFeedUrl, setPersonalFeedUrl] = useState("");
  const [orgFeedUrl, setOrgFeedUrl] = useState("");
  const [personalFeeds, setPersonalFeeds] = useState<FeedSummary[]>([]);
  const [orgFeeds, setOrgFeeds] = useState<FeedSummary[]>([]);
  const [orgEvents, setOrgEvents] = useState<CalendarEventSummary[]>([]);
  const [loadingPersonalFeeds, setLoadingPersonalFeeds] = useState(true);
  const [loadingOrgFeeds, setLoadingOrgFeeds] = useState(isAdmin);
  const [loadingOrgEvents, setLoadingOrgEvents] = useState(true);
  const [connectingPersonal, setConnectingPersonal] = useState(false);
  const [connectingOrg, setConnectingOrg] = useState(false);
  const [syncingFeedId, setSyncingFeedId] = useState<string | null>(null);
  const [disconnectingFeedId, setDisconnectingFeedId] = useState<string | null>(null);
  const [personalError, setPersonalError] = useState<string | null>(null);
  const [personalNotice, setPersonalNotice] = useState<string | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [orgNotice, setOrgNotice] = useState<string | null>(null);
  const [orgEventsError, setOrgEventsError] = useState<string | null>(null);

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

  const handleConnectPersonal = async () => {
    if (!personalFeedUrl.trim()) {
      setPersonalError("Paste a calendar link to connect.");
      return;
    }

    setPersonalError(null);
    setPersonalNotice(null);
    setConnectingPersonal(true);

    try {
      const response = await fetch("/api/calendar/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedUrl: personalFeedUrl.trim(),
          provider: "ics",
          organizationId,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to connect feed.");
      }

      setPersonalFeedUrl("");
      setPersonalNotice("Schedule connected. We will keep it in sync.");
      await refreshAll();
      notifyAvailabilityRefresh();
    } catch (err) {
      setPersonalError(err instanceof Error ? err.message : "Failed to connect feed.");
    } finally {
      setConnectingPersonal(false);
    }
  };

  const handleConnectOrg = async () => {
    if (!orgFeedUrl.trim()) {
      setOrgError("Paste a calendar link to connect.");
      return;
    }

    setOrgError(null);
    setOrgNotice(null);
    setConnectingOrg(true);

    try {
      const response = await fetch("/api/calendar/org-feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedUrl: orgFeedUrl.trim(),
          provider: "ics",
          organizationId,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to connect org feed.");
      }

      setOrgFeedUrl("");
      setOrgNotice("Org calendar connected. Everyone will see upcoming events.");
      await refreshAll();
      notifyAvailabilityRefresh();
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Failed to connect org feed.");
    } finally {
      setConnectingOrg(false);
    }
  };

  const handleSyncNow = async (feedId: string, scope: "personal" | "org") => {
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

  const handleDisconnect = async (feedId: string, scope: "personal" | "org") => {
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                label="Paste calendar link (ICS)"
                value={personalFeedUrl}
                onChange={(event) => setPersonalFeedUrl(event.target.value)}
                placeholder="https://school.example.edu/calendar.ics"
                helperText="Works with Canvas, Schoology, Brightspace, Blackboard, Moodle, Google Calendar (public links), and more."
              />
            </div>
            <Button onClick={handleConnectPersonal} isLoading={connectingPersonal}>
              Add schedule via calendar link (ICS)
            </Button>
          </div>
          {personalNotice && <p className="text-sm text-foreground">{personalNotice}</p>}
          {personalError && <p className="text-sm text-error">{personalError}</p>}
        </Card>
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">Manage My Schedules</h2>
        </div>
        <Card className="p-4">
          {loadingPersonalFeeds ? (
            <p className="text-sm text-muted-foreground">Loading schedules...</p>
          ) : personalFeeds.length === 0 ? (
            <EmptyState
              title="No connected schedules"
              description="Connect a calendar feed to keep your availability in sync."
            />
          ) : (
            <div className="space-y-3">
              {personalFeeds.map((feed) => (
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
                      onClick={() => handleSyncNow(feed.id, "personal")}
                    >
                      Sync now
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      isLoading={disconnectingFeedId === feed.id}
                      onClick={() => handleDisconnect(feed.id, "personal")}
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

      {isAdmin && (
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Org Events Calendar</h2>
          <Card className="p-4 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Input
                  label="Paste org calendar link (ICS)"
                  value={orgFeedUrl}
                  onChange={(event) => setOrgFeedUrl(event.target.value)}
                  placeholder="https://calendar.example.com/team.ics"
                  helperText="Use a shared org calendar link so everyone sees the same upcoming events."
                />
              </div>
              <Button onClick={handleConnectOrg} isLoading={connectingOrg}>
                Add org calendar via calendar link (ICS)
              </Button>
            </div>
            {orgNotice && <p className="text-sm text-foreground">{orgNotice}</p>}
            {orgError && <p className="text-sm text-error">{orgError}</p>}
          </Card>

          <div className="mt-4">
            <Card className="p-4">
              {loadingOrgFeeds ? (
                <p className="text-sm text-muted-foreground">Loading org calendars...</p>
              ) : orgFeeds.length === 0 ? (
                <EmptyState
                  title="No org calendars connected"
                  description="Connect a shared calendar to show upcoming org events."
                />
              ) : (
                <div className="space-y-3">
                  {orgFeeds.map((feed) => (
                    <div
                      key={feed.id}
                      className="flex flex-col gap-3 border border-border/60 rounded-xl p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-foreground">Org ICS Feed</p>
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
                          onClick={() => handleSyncNow(feed.id, "org")}
                        >
                          Sync now
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          isLoading={disconnectingFeedId === feed.id}
                          onClick={() => handleDisconnect(feed.id, "org")}
                        >
                          Disconnect
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </section>
      )}

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
