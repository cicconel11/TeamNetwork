"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

type GoogleCalendar = {
  id: string;
  summary: string;
  primary: boolean;
};

type TeamGoogleCalendarConnectProps = {
  orgId: string;
  orgSlug: string;
  isAdmin: boolean;
  isReadOnly?: boolean;
  onSourceAdded: () => Promise<void>;
};

type ConnectionState = "loading" | "not_connected" | "connected";

export function TeamGoogleCalendarConnect({
  orgId,
  orgSlug,
  isAdmin,
  isReadOnly,
  onSourceAdded,
}: TeamGoogleCalendarConnectProps) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("loading");
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [calendarsLoading, setCalendarsLoading] = useState(false);
  const [selectedCalendarId, setSelectedCalendarId] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Check Google connection
  useEffect(() => {
    async function checkConnection() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setConnectionState("not_connected");
          return;
        }

        const { data } = await supabase
          .from("user_calendar_connections")
          .select("id, status")
          .eq("user_id", user.id)
          .maybeSingle();

        if (data && data.status === "connected") {
          setConnectionState("connected");
        } else {
          setConnectionState("not_connected");
        }
      } catch {
        setConnectionState("not_connected");
      }
    }
    checkConnection();
  }, []);

  // Load calendars when connected
  useEffect(() => {
    if (connectionState !== "connected") return;

    async function loadCalendars() {
      setCalendarsLoading(true);
      try {
        const response = await fetch("/api/google/calendars");
        if (!response.ok) {
          setCalendars([]);
          return;
        }
        const data = await response.json();
        setCalendars(data.calendars || []);
      } catch {
        setCalendars([]);
      } finally {
        setCalendarsLoading(false);
      }
    }
    loadCalendars();
  }, [connectionState]);

  const handleConnect = useCallback(() => {
    window.location.href = `/api/google/auth?redirect=${encodeURIComponent(`/${orgSlug}/calendar/sources`)}`;
  }, [orgSlug]);

  const handleAddToTeamSchedule = useCallback(async () => {
    if (!selectedCalendarId) {
      setError("Select a calendar to add.");
      return;
    }

    const selectedCal = calendars.find((c) => c.id === selectedCalendarId);
    const title = selectedCal?.summary || "Google Calendar";

    setConnecting(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/schedules/google/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          googleCalendarId: selectedCalendarId,
          title,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || data?.error || "Failed to connect Google Calendar.");
      }

      setSelectedCalendarId("");
      setNotice("Google Calendar added to team schedule.");
      await onSourceAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect Google Calendar.");
    } finally {
      setConnecting(false);
    }
  }, [calendars, onSourceAdded, orgId, selectedCalendarId]);

  if (!isAdmin) return null;

  return (
    <section>
      <Card className="bg-gradient-to-br from-card to-muted/30 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-org-secondary/10 rounded-lg">
            <GoogleCalendarIcon className="w-5 h-5 text-org-secondary" />
          </div>
          <h2 className="text-lg font-display font-semibold text-foreground">Connect Google Calendar</h2>
        </div>

        {isReadOnly && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            Team schedule changes are disabled while your subscription is inactive.
          </div>
        )}

        {connectionState === "loading" ? (
          <p className="text-sm text-muted-foreground">Checking Google connection...</p>
        ) : connectionState === "not_connected" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connect your Google account to import a Google Calendar as a team schedule source.
            </p>
            <Button variant="secondary" onClick={handleConnect} disabled={isReadOnly}>
              Connect Google Account
            </Button>
          </div>
        ) : calendarsLoading ? (
          <p className="text-sm text-muted-foreground">Loading calendars...</p>
        ) : calendars.length === 0 ? (
          <p className="text-sm text-muted-foreground">No calendars found in your Google account.</p>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="team-google-cal" className="block text-sm font-medium text-foreground mb-1">
                Google Calendar
              </label>
              <select
                id="team-google-cal"
                value={selectedCalendarId}
                onChange={(e) => {
                  setSelectedCalendarId(e.target.value);
                  setError(null);
                  setNotice(null);
                }}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
              >
                <option value="">Select a calendar...</option>
                {calendars.map((cal) => (
                  <option key={cal.id} value={cal.id}>
                    {cal.summary}{cal.primary ? " (Primary)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={handleAddToTeamSchedule} isLoading={connecting} disabled={isReadOnly}>
              Add to Team Schedule
            </Button>
          </div>
        )}

        {notice && <p className="text-sm text-foreground">{notice}</p>}
        {error && <p className="text-sm text-error">{error}</p>}
      </Card>
    </section>
  );
}

function GoogleCalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.25A2.75 2.75 0 0118 6.75v8.5A2.75 2.75 0 0115.25 18H4.75A2.75 2.75 0 012 15.25v-8.5A2.75 2.75 0 014.75 4H5V2.75A.75.75 0 015.75 2zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75z" clipRule="evenodd" />
    </svg>
  );
}
