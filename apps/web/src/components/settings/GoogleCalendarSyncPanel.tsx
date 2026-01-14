"use client";

import { useState, useEffect } from "react";
import { Badge, Button, Card, Select } from "@/components/ui";

export interface SyncPreferences {
  sync_general: boolean;
  sync_game: boolean;
  sync_meeting: boolean;
  sync_social: boolean;
  sync_fundraiser: boolean;
  sync_philanthropy: boolean;
}

interface CalendarConnection {
  googleEmail: string;
  status: "connected" | "disconnected" | "error";
  lastSyncAt: string | null;
}

interface GoogleCalendar {
  id: string;
  summary: string;
  primary: boolean;
  backgroundColor?: string;
}

interface GoogleCalendarSyncPanelProps {
  orgName: string;
  organizationId: string;
  connection: CalendarConnection | null;
  isConnected: boolean;
  connectionLoading: boolean;
  calendars: GoogleCalendar[];
  calendarsLoading: boolean;
  targetCalendarId: string;
  preferences: SyncPreferences;
  preferencesLoading: boolean;
  reconnectRequired: boolean;
  onConnect: () => void;
  onDisconnect: () => Promise<void>;
  onSync: () => Promise<{ message: string; syncedCount?: number; failedCount?: number }>;
  onReconnect: () => void;
  onTargetCalendarChange: (calendarId: string) => Promise<void>;
  onPreferenceChange: (prefs: SyncPreferences) => Promise<void>;
}

const EVENT_TYPE_LABELS: Record<keyof SyncPreferences, { label: string; description: string }> = {
  sync_general: {
    label: "General Events",
    description: "General organization events and activities",
  },
  sync_game: {
    label: "Games",
    description: "Sports games and competitions",
  },
  sync_meeting: {
    label: "Meetings",
    description: "Chapter meetings and gatherings",
  },
  sync_social: {
    label: "Social Events",
    description: "Social gatherings and parties",
  },
  sync_fundraiser: {
    label: "Fundraisers",
    description: "Fundraising events and campaigns",
  },
  sync_philanthropy: {
    label: "Philanthropy",
    description: "Community service and philanthropy events",
  },
};

function CalendarIcon() {
  return (
    <svg
      className="w-5 h-5 text-foreground"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm-8 4H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z" />
    </svg>
  );
}

function formatLastSync(lastSyncAt: string | null): string {
  if (!lastSyncAt) return "Never";
  return new Date(lastSyncAt).toLocaleString();
}

function getStatusBadge(status: CalendarConnection["status"]) {
  switch (status) {
    case "connected":
      return <Badge variant="success">Connected</Badge>;
    case "disconnected":
      return <Badge variant="warning">Disconnected</Badge>;
    case "error":
      return <Badge variant="error">Error</Badge>;
    default:
      return <Badge variant="muted">Unknown</Badge>;
  }
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 text-org-secondary"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export function GoogleCalendarSyncPanel({
  orgName,
  organizationId,
  connection,
  isConnected,
  connectionLoading,
  calendars,
  calendarsLoading,
  targetCalendarId,
  preferences,
  preferencesLoading,
  reconnectRequired,
  onConnect,
  onDisconnect,
  onSync,
  onReconnect,
  onTargetCalendarChange,
  onPreferenceChange,
}: GoogleCalendarSyncPanelProps) {
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Auto-dismiss feedback after 5 seconds
  useEffect(() => {
    if (!actionNotice) return;
    const timer = setTimeout(() => setActionNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [actionNotice]);

  useEffect(() => {
    if (!actionError) return;
    const timer = setTimeout(() => setActionError(null), 5000);
    return () => clearTimeout(timer);
  }, [actionError]);
  const [targetError, setTargetError] = useState<string | null>(null);

  // Preferences local state for optimistic updates
  const [localPreferences, setLocalPreferences] = useState<SyncPreferences>(preferences);
  const [savingKey, setSavingKey] = useState<keyof SyncPreferences | null>(null);
  const [prefError, setPrefError] = useState<string | null>(null);

  useEffect(() => {
    setLocalPreferences(preferences);
  }, [preferences]);

  const handleDisconnect = async () => {
    if (!confirm("Disconnect your Google Calendar? Events already synced will remain.")) return;
    setIsDisconnecting(true);
    setActionError(null);
    setActionNotice(null);
    try {
      await onDisconnect();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const result = await onSync();
      setActionNotice(result.message);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to sync");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleTargetCalendarChange = async (calendarId: string) => {
    setTargetError(null);
    try {
      await onTargetCalendarChange(calendarId);
    } catch (err) {
      setTargetError(err instanceof Error ? err.message : "Failed to update target calendar");
    }
  };

  const handleToggle = async (key: keyof SyncPreferences) => {
    if (savingKey) return;

    const newValue = !localPreferences[key];
    const newPreferences = { ...localPreferences, [key]: newValue };

    setLocalPreferences(newPreferences);
    setSavingKey(key);
    setPrefError(null);

    try {
      await onPreferenceChange(newPreferences);
    } catch (err) {
      setLocalPreferences(localPreferences);
      setPrefError(err instanceof Error ? err.message : "Failed to save preference");
    } finally {
      setSavingKey(null);
    }
  };

  // Build calendar dropdown options
  const calendarOptions = calendarsLoading
    ? [{ value: targetCalendarId, label: "Loading calendars..." }]
    : calendars.length > 0
    ? calendars.map((cal) => ({
        value: cal.id,
        label: cal.primary ? `${cal.summary} (Primary)` : cal.summary,
      }))
    : [{ value: "primary", label: "Primary Calendar" }];

  // --- Loading skeleton ---
  if (connectionLoading) {
    return (
      <Card className="p-5">
        <div className="animate-pulse space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 bg-muted rounded" />
            <div className="h-5 bg-muted rounded w-48" />
          </div>
          <div className="h-4 bg-muted rounded w-2/3" />
          <div className="border-t border-border/60 pt-4 space-y-3">
            <div className="h-4 bg-muted rounded w-1/4" />
            <div className="h-9 bg-muted rounded w-full" />
          </div>
          <div className="border-t border-border/60 pt-4 space-y-3">
            <div className="h-4 bg-muted rounded w-1/3" />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="h-4 w-4 bg-muted rounded" />
                  <div className="h-4 bg-muted rounded w-20" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
    );
  }

  // --- Disconnected state ---
  if (!isConnected) {
    return (
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <CalendarIcon />
          <p className="font-medium text-foreground">Google Calendar Sync</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Automatically sync {orgName}&apos;s events to your personal Google Calendar.
          Games, meetings, socials, and more — always up to date.
        </p>

        {connection?.status === "disconnected" && (
          <div className="text-sm text-amber-600 dark:text-amber-400">
            Your Google Calendar connection has been disconnected. Please reconnect to continue syncing events.
          </div>
        )}
        {connection?.status === "error" && (
          <div className="text-sm text-red-600 dark:text-red-400">
            There was an error with your Google Calendar connection. Please try reconnecting.
          </div>
        )}

        <Button onClick={onConnect}>
          Connect Google Calendar
        </Button>
      </Card>
    );
  }

  // --- Connected state ---
  const eventTypeKeys = Object.keys(EVENT_TYPE_LABELS) as (keyof SyncPreferences)[];

  return (
    <Card className="divide-y divide-border/60">
      {/* Section 1: Connection status */}
      <div className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <CalendarIcon />
            <p className="font-medium text-foreground">Google Calendar Sync</p>
          </div>
          {connection && getStatusBadge(connection.status)}
        </div>

        <div className="space-y-1 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Account:</span>
            <span className="font-medium text-foreground">{connection?.googleEmail}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Last synced:</span>
            <span className="text-foreground">{formatLastSync(connection?.lastSyncAt ?? null)}</span>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {orgName}&apos;s events sync to your Google Calendar automatically.
        </p>

        {connection?.status === "error" && (
          <div className="text-sm text-red-600 dark:text-red-400">
            There was an error with your Google Calendar connection. Please try reconnecting.
          </div>
        )}

      </div>

      {/* Section 2: Target calendar picker OR reconnect prompt */}
      <div className="p-5 space-y-3">
        {reconnectRequired ? (
          <>
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Reconnect your Google account to enable calendar selection. Your sync will continue using your primary calendar.
            </p>
            <Button variant="secondary" size="sm" onClick={onReconnect}>
              Reconnect Google Account
            </Button>
          </>
        ) : (
          <>
            <Select
              label="Sync events to"
              options={calendarOptions}
              value={targetCalendarId}
              onChange={(e) => handleTargetCalendarChange(e.target.value)}
              disabled={calendarsLoading}
            />
            {targetError && (
              <p className="text-sm text-error">{targetError}</p>
            )}
          </>
        )}
      </div>

      {/* Section 3: Event type preferences */}
      <div className="p-5 space-y-3">
        {preferencesLoading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-muted rounded w-1/3" />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="h-4 w-4 bg-muted rounded" />
                  <div className="h-4 bg-muted rounded w-20" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div>
              <p className="font-medium text-sm text-foreground">Event types</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Choose which event types to include in your calendar.
              </p>
            </div>

            {prefError && (
              <div className="text-sm text-red-600 dark:text-red-400">{prefError}</div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
              {eventTypeKeys.map((key) => {
                const { label } = EVENT_TYPE_LABELS[key];
                const isChecked = localPreferences[key];
                const isSaving = savingKey === key;

                return (
                  <label
                    key={key}
                    htmlFor={`${organizationId}-${key}`}
                    className={`flex items-center gap-2 cursor-pointer ${
                      savingKey ? "opacity-60 cursor-not-allowed" : ""
                    }`}
                  >
                    <div className="relative flex items-center justify-center">
                      <input
                        id={`${organizationId}-${key}`}
                        type="checkbox"
                        className="h-4 w-4 rounded border-border"
                        checked={isChecked}
                        onChange={() => handleToggle(key)}
                        disabled={!!savingKey}
                      />
                      {isSaving && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Spinner />
                        </div>
                      )}
                    </div>
                    <span className="text-sm text-foreground">{label}</span>
                  </label>
                );
              })}
            </div>

            <p className="text-xs text-muted-foreground">
              Changes are saved automatically.
            </p>
          </>
        )}
      </div>

      {/* Section 4: Actions footer */}
      <div className="p-5 space-y-3">
        {actionNotice && (
          <div className="rounded-md bg-green-50 dark:bg-green-900/20 px-3 py-2 text-sm text-green-700 dark:text-green-300">
            {actionNotice}
          </div>
        )}
        {actionError && (
          <div className="rounded-md bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {actionError}
          </div>
        )}
        <div className="flex items-center justify-between">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleSync}
          isLoading={isSyncing}
          disabled={isDisconnecting}
        >
          Sync Now
        </Button>
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={isSyncing || isDisconnecting}
          className="text-sm text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
        >
          {isDisconnecting ? "Disconnecting..." : "Disconnect"}
        </button>
        </div>
      </div>
    </Card>
  );
}
