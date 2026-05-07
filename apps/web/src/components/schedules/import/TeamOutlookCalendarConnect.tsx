"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

type OutlookCalendar = {
  id: string;
  name: string;
  isDefault: boolean;
  hexColor?: string;
};

type TeamOutlookCalendarConnectProps = {
  orgId: string;
  orgSlug: string;
  isAdmin: boolean;
  isReadOnly?: boolean;
  onSourceAdded: () => Promise<void>;
};

type ConnectionState = "loading" | "not_connected" | "connected" | "reconnect_required";

export function TeamOutlookCalendarConnect({
  orgId,
  orgSlug,
  isAdmin,
  isReadOnly,
  onSourceAdded,
}: TeamOutlookCalendarConnectProps) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("loading");
  const [calendars, setCalendars] = useState<OutlookCalendar[]>([]);
  const [calendarsLoading, setCalendarsLoading] = useState(false);
  const [selectedCalendarId, setSelectedCalendarId] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Check Outlook connection
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
          .eq("provider", "outlook")
          .maybeSingle();

        if (data && data.status === "connected") {
          setConnectionState("connected");
        } else if (data && data.status === "reconnect_required") {
          setConnectionState("reconnect_required");
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
        const response = await fetch("/api/microsoft/calendars?mode=team_import");
        const data = await response.json();
        if (response.status === 403 && data?.error === "reconnect_required") {
          setCalendars([]);
          setConnectionState("reconnect_required");
          return;
        }
        if (!response.ok) {
          setCalendars([]);
          return;
        }
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
    window.location.href = `/api/microsoft/auth?redirect=${encodeURIComponent(`/${orgSlug}/calendar/sources`)}`;
  }, [orgSlug]);

  const handleAddToTeamSchedule = useCallback(async () => {
    if (!selectedCalendarId) {
      setError("Select a calendar to add.");
      return;
    }

    const selectedCal = calendars.find((c) => c.id === selectedCalendarId);
    const title = selectedCal?.name || "Outlook Calendar";

    setConnecting(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/schedules/outlook/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          outlookCalendarId: selectedCalendarId,
          title,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || data?.error || "Failed to connect Outlook Calendar.");
      }

      setSelectedCalendarId("");
      setNotice("Outlook Calendar added to team schedule.");
      await onSourceAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect Outlook Calendar.");
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
            <MicrosoftIcon className="w-5 h-5" />
          </div>
          <h2 className="text-lg font-display font-semibold text-foreground">Connect Outlook Calendar</h2>
        </div>

        {isReadOnly && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            Team schedule changes are disabled while your subscription is inactive.
          </div>
        )}

        {connectionState === "loading" ? (
          <p className="text-sm text-muted-foreground">Checking Outlook connection...</p>
        ) : connectionState === "not_connected" || connectionState === "reconnect_required" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {connectionState === "reconnect_required"
                ? "Reconnect your Microsoft Outlook account to refresh calendar access before importing a team schedule."
                : "Connect your Microsoft Outlook account to import an Outlook Calendar as a team schedule source."}
            </p>
            <Button variant="secondary" onClick={handleConnect} disabled={isReadOnly}>
              {connectionState === "reconnect_required" ? "Reconnect Outlook Account" : "Connect Outlook Account"}
            </Button>
          </div>
        ) : calendarsLoading ? (
          <p className="text-sm text-muted-foreground">Loading calendars...</p>
        ) : calendars.length === 0 ? (
          <p className="text-sm text-muted-foreground">No calendars found in your Outlook account.</p>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="team-outlook-cal" className="block text-sm font-medium text-foreground mb-1">
                Outlook Calendar
              </label>
              <select
                id="team-outlook-cal"
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
                    {cal.name}{cal.isDefault ? " (Default)" : ""}
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

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 21 21" fill="none">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}
