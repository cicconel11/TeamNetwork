"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, EmptyState, Input } from "@/components/ui";
import { GoogleCalendarSyncPanel } from "@/components/settings/GoogleCalendarSyncPanel";
import { useGoogleCalendarSync } from "@/hooks/useGoogleCalendarSync";
import { resolveActionLabel } from "@/lib/navigation/label-resolver";
import type { AcademicSchedule } from "@/types/database";
import type { NavConfig } from "@/lib/navigation/nav-items";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type FeedSummary = {
  id: string;
  maskedUrl: string;
  status: "active" | "error" | "disabled";
  last_synced_at: string | null;
  last_error?: string | null;
  provider?: string | null;
};

type MyCalendarTabProps = {
  orgId: string;
  orgSlug: string;
  orgName: string;
  mySchedules: AcademicSchedule[];
  navConfig: NavConfig | null;
  pageLabel: string;
};

function formatDateTime(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString();
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

function formatOccurrence(schedule: AcademicSchedule): string {
  switch (schedule.occurrence_type) {
    case "single":
      return new Date(schedule.start_date).toLocaleDateString();
    case "daily":
      return "Daily";
    case "weekly":
      if (schedule.day_of_week && schedule.day_of_week.length > 0) {
        const labels = schedule.day_of_week.map((day) => DAYS[day]).join(", ");
        return `Every ${labels}`;
      }
      return "Weekly";
    case "monthly":
      return schedule.day_of_month
        ? `Monthly on the ${schedule.day_of_month}${getOrdinalSuffix(schedule.day_of_month)}`
        : "Monthly";
    default:
      return schedule.occurrence_type;
  }
}

function getOrdinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function formatTime(time: string): string {
  const [hours, minutes] = time.split(":");
  const h = parseInt(hours, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${minutes} ${ampm}`;
}

function isLikelyIcsUrl(feedUrl: string) {
  const lower = feedUrl.toLowerCase();
  return lower.includes(".ics") || lower.includes("ical") || lower.includes("calendar");
}

export function MyCalendarTab({
  orgId,
  orgSlug,
  orgName,
  mySchedules,
  navConfig,
  pageLabel,
}: MyCalendarTabProps) {
  // Google Calendar Sync hook
  const gcal = useGoogleCalendarSync({ orgId, orgSlug });

  // Personal calendar feed state
  const [feedUrl, setFeedUrl] = useState("");
  const [personalFeeds, setPersonalFeeds] = useState<FeedSummary[]>([]);
  const [loadingFeeds, setLoadingFeeds] = useState(true);
  const [connectingFeed, setConnectingFeed] = useState(false);
  const [syncingFeedId, setSyncingFeedId] = useState<string | null>(null);
  const [disconnectingFeedId, setDisconnectingFeedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshFeeds = useCallback(async () => {
    setLoadingFeeds(true);
    setError(null);
    try {
      const response = await fetch(`/api/calendar/feeds?organizationId=${orgId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to load feeds.");
      }

      setPersonalFeeds(data.feeds || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load feeds.");
    } finally {
      setLoadingFeeds(false);
    }
  }, [orgId]);

  useEffect(() => {
    refreshFeeds();
  }, [refreshFeeds]);

  const notifyAvailabilityRefresh = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("calendar:refresh"));
    }
  };

  const handleConnect = async () => {
    const rawUrl = feedUrl.trim();

    if (!rawUrl) {
      setError("Paste a calendar link to connect.");
      return;
    }

    if (!isLikelyIcsUrl(rawUrl)) {
      setError("Personal calendars must be an iCal/ICS link.");
      return;
    }

    setError(null);
    setNotice(null);
    setConnectingFeed(true);

    try {
      const response = await fetch("/api/calendar/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedUrl: rawUrl,
          provider: "ics",
          organizationId: orgId,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to connect feed.");
      }

      setFeedUrl("");
      setNotice("Schedule connected. We will keep it in sync.");
      await refreshFeeds();
      notifyAvailabilityRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect feed.");
    } finally {
      setConnectingFeed(false);
    }
  };

  const handleSyncNow = async (feedId: string) => {
    setError(null);
    setNotice(null);
    setSyncingFeedId(feedId);

    try {
      const response = await fetch(`/api/calendar/feeds/${feedId}/sync`, { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to sync feed.");
      }

      setNotice("Schedule synced.");
      await refreshFeeds();
      notifyAvailabilityRefresh();
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
      const response = await fetch(`/api/calendar/feeds/${feedId}`, { method: "DELETE" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to disconnect feed.");
      }

      setNotice("Schedule disconnected.");
      await refreshFeeds();
      notifyAvailabilityRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect feed.");
    } finally {
      setDisconnectingFeedId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Section 1: Google Calendar Sync */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">Google Calendar Sync</h2>

        {/* OAuth callback banners */}
        {gcal.oauthStatus === "connected" && (
          <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-sm text-green-700 dark:text-green-300">
            Google Calendar connected successfully! Your events will now sync automatically.
          </div>
        )}
        {gcal.oauthError && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300">
            {gcal.oauthError === "access_denied"
              ? "You denied access to your Google Calendar. Please try again and allow access."
              : gcal.oauthError === "invalid_code"
              ? "The authorization code has expired. Please try connecting again."
              : gcal.oauthError === "oauth_init_failed"
              ? "Google Calendar integration is not configured. Please contact the administrator."
              : gcal.oauthErrorMessage || "Failed to connect Google Calendar. Please try again."}
          </div>
        )}

        <GoogleCalendarSyncPanel
          orgName={orgName}
          organizationId={orgId}
          connection={gcal.connection}
          isConnected={gcal.isConnected}
          connectionLoading={gcal.connectionLoading}
          calendars={gcal.calendars}
          calendarsLoading={gcal.calendarsLoading}
          targetCalendarId={gcal.targetCalendarId}
          preferences={gcal.preferences}
          preferencesLoading={gcal.preferencesLoading}
          reconnectRequired={gcal.reconnectRequired}
          onConnect={gcal.connect}
          onDisconnect={gcal.disconnect}
          onSync={gcal.syncNow}
          onReconnect={gcal.reconnect}
          onTargetCalendarChange={gcal.setTargetCalendar}
          onPreferenceChange={gcal.updatePreferences}
        />
      </section>

      {/* Section 2: Personal Calendar Feeds */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">Personal Calendar Feeds</h2>
        <Card className="p-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                label="Paste calendar link (ICS)"
                value={feedUrl}
                onChange={(event) => {
                  setFeedUrl(event.target.value);
                  setError(null);
                  setNotice(null);
                }}
                placeholder="https://school.example.edu/calendar.ics"
                helperText="Works with Canvas, Schoology, Brightspace, Blackboard, Moodle, Google Calendar (public links), and more."
              />
            </div>
            <Button onClick={handleConnect} isLoading={connectingFeed}>
              Add calendar link
            </Button>
          </div>
          {notice && <p className="text-sm text-foreground">{notice}</p>}
          {error && <p className="text-sm text-error">{error}</p>}
        </Card>

        <div className="mt-4">
          <Card className="p-4">
            {loadingFeeds ? (
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
        </div>
      </section>

      {/* Section 3: My Schedules */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">My {pageLabel}</h2>
        {mySchedules && mySchedules.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mySchedules.map((schedule) => (
              <Card key={schedule.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-foreground truncate">{schedule.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {formatTime(schedule.start_time)} - {formatTime(schedule.end_time)}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="muted">{formatOccurrence(schedule)}</Badge>
                    </div>
                    {schedule.notes && (
                      <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{schedule.notes}</p>
                    )}
                  </div>
                  <Link href={`/${orgSlug}/schedules/${schedule.id}/edit`}>
                    <Button variant="ghost" size="sm">Edit</Button>
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState
              title={`No ${pageLabel.toLowerCase()} yet`}
              description={`Add your class ${pageLabel.toLowerCase()} so coaches can plan around your availability.`}
              action={
                <Link href={`/${orgSlug}/schedules/new`}>
                  <Button>{resolveActionLabel("/schedules", navConfig, "Add First")}</Button>
                </Link>
              }
            />
          </Card>
        )}
      </section>
    </div>
  );
}
