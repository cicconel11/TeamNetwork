"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, Select, InlineBanner } from "@/components/ui";
import { showFeedback } from "@/lib/feedback/show-feedback";
import type { SyncPreferences } from "@/components/settings/GoogleCalendarSyncPanel";
import type { OutlookCalendar } from "@/hooks/useOutlookCalendarSync";

interface CalendarConnection {
  providerEmail: string;
  status: "connected" | "disconnected" | "reconnect_required" | "error";
  lastSyncAt: string | null;
}

interface OutlookCalendarSyncPanelProps {
  orgName: string;
  organizationId: string;
  connection: CalendarConnection | null;
  isConnected: boolean;
  connectionLoading: boolean;
  calendars: OutlookCalendar[];
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

const EVENT_TYPE_KEYS: (keyof SyncPreferences)[] = [
  "sync_general",
  "sync_game",
  "sync_meeting",
  "sync_social",
  "sync_fundraiser",
  "sync_philanthropy",
  "sync_practice",
  "sync_workout",
];

function MicrosoftIcon() {
  return (
    <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 21 21" fill="none">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

function formatLastSync(lastSyncAt: string | null, neverLabel: string): string {
  if (!lastSyncAt) return neverLabel;
  return new Date(lastSyncAt).toLocaleString();
}

function getStatusBadge(status: CalendarConnection["status"], connectedLabel: string, disconnectedLabel: string, errorLabel: string) {
  switch (status) {
    case "connected":
      return <Badge variant="success">{connectedLabel}</Badge>;
    case "disconnected":
      return <Badge variant="warning">{disconnectedLabel}</Badge>;
    case "reconnect_required":
      return <Badge variant="warning">Reconnect required</Badge>;
    case "error":
      return <Badge variant="error">{errorLabel}</Badge>;
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
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export function OutlookCalendarSyncPanel({
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
}: OutlookCalendarSyncPanelProps) {
  const tGCal = useTranslations("googleCalendar");
  const tCommon = useTranslations("common");
  const tSchedules = useTranslations("schedules");
  const tEvents = useTranslations("events");
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [targetError, setTargetError] = useState<string | null>(null);

  const [localPreferences, setLocalPreferences] = useState<SyncPreferences>(preferences);
  const [savingKey, setSavingKey] = useState<keyof SyncPreferences | null>(null);
  const [prefError, setPrefError] = useState<string | null>(null);

  useEffect(() => {
    setLocalPreferences(preferences);
  }, [preferences]);

  const handleDisconnect = async () => {
    if (!confirm("Are you sure you want to disconnect Outlook Calendar? You can reconnect at any time.")) return;
    setIsDisconnecting(true);
    try {
      await onDisconnect();
    } catch (err) {
      showFeedback(err instanceof Error ? err.message : "Failed to disconnect Outlook Calendar", "error", { duration: 5000 });
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await onSync();
      showFeedback(result.message, "success", { duration: 5000 });
    } catch (err) {
      showFeedback(err instanceof Error ? err.message : "Failed to sync Outlook Calendar", "error", { duration: 5000 });
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

  const calendarOptions = calendarsLoading
    ? [{ value: targetCalendarId, label: tSchedules("loadingCalendars") }]
    : calendars.length > 0
    ? calendars.map((cal) => ({
        value: cal.id,
        label: cal.isDefault ? `${cal.name} (Default)` : cal.name,
      }))
    : [{ value: "primary", label: "Default Calendar" }];

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
        </div>
      </Card>
    );
  }

  // --- Disconnected state ---
  if (!isConnected) {
    return (
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <MicrosoftIcon />
          <p className="font-medium text-foreground">Outlook Calendar</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Connect your Microsoft Outlook account to automatically sync {orgName} events to your personal Outlook calendar.
        </p>

        {connection?.status === "disconnected" && (
          <InlineBanner variant="warning">Your Outlook Calendar was disconnected.</InlineBanner>
        )}
        {connection?.status === "reconnect_required" && (
          <InlineBanner variant="warning">Your Outlook connection needs to be re-authorized. Please reconnect.</InlineBanner>
        )}
        {connection?.status === "error" && (
          <InlineBanner variant="error">There was an error with your Outlook Calendar connection.</InlineBanner>
        )}

        <Button onClick={onConnect}>
          Connect Outlook Calendar
        </Button>
      </Card>
    );
  }

  const eventTypeLabels: Record<keyof SyncPreferences, string> = {
    sync_general: tGCal("types.general.label"),
    sync_game: tEvents("game"),
    sync_meeting: tGCal("types.meeting.label"),
    sync_social: tGCal("types.social.label"),
    sync_fundraiser: tGCal("types.fundraiser.label"),
    sync_philanthropy: tEvents("philanthropy"),
    sync_practice: tEvents("practice"),
    sync_workout: tEvents("workout"),
  };

  return (
    <Card className="divide-y divide-border/60">
      {/* Section 1: Connection status */}
      <div className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <MicrosoftIcon />
            <p className="font-medium text-foreground">Outlook Calendar</p>
          </div>
          {connection && getStatusBadge(connection.status, tCommon("connected"), "Disconnected", tCommon("error"))}
        </div>

        <div className="space-y-1 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Microsoft account</span>
            <span className="font-medium text-foreground">{connection?.providerEmail}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{tGCal("lastSynced")}</span>
            <span className="text-foreground">{formatLastSync(connection?.lastSyncAt ?? null, tCommon("never"))}</span>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {orgName} events are automatically synced to your Outlook calendar.
        </p>

        {connection?.status === "error" && (
          <InlineBanner variant="error">There was an error with your Outlook Calendar connection.</InlineBanner>
        )}
      </div>

      {/* Section 2: Target calendar picker OR reconnect prompt */}
      <div className="p-5 space-y-3">
        {reconnectRequired ? (
          <>
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Your Outlook connection needs to be re-authorized. Please reconnect to continue syncing events.
            </p>
            <Button variant="secondary" size="sm" onClick={onReconnect}>
              Reconnect Outlook
            </Button>
          </>
        ) : (
          <>
            <Select
              label={tGCal("syncEventsTo")}
              options={calendarOptions}
              value={targetCalendarId}
              onChange={(e) => handleTargetCalendarChange(e.target.value)}
              disabled={calendarsLoading}
            />
            {targetError && (
              <InlineBanner variant="error">{targetError}</InlineBanner>
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
              <p className="font-medium text-sm text-foreground">{tGCal("eventTypes")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {tGCal("eventTypesDesc")}
              </p>
            </div>

            {prefError && (
              <InlineBanner variant="error">{prefError}</InlineBanner>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
              {EVENT_TYPE_KEYS.map((key) => {
                const isChecked = localPreferences[key];
                const isSaving = savingKey === key;

                return (
                  <label
                    key={key}
                    htmlFor={`outlook-${organizationId}-${key}`}
                    className={`flex items-center gap-2 cursor-pointer ${
                      savingKey ? "opacity-60 cursor-not-allowed" : ""
                    }`}
                  >
                    <div className="relative flex items-center justify-center">
                      <input
                        id={`outlook-${organizationId}-${key}`}
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
                    <span className="text-sm text-foreground">{eventTypeLabels[key]}</span>
                  </label>
                );
              })}
            </div>

            <p className="text-xs text-muted-foreground">
              {tGCal("autoSaved")}
            </p>
          </>
        )}
      </div>

      {/* Section 4: Actions footer */}
      <div className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSync}
            isLoading={isSyncing}
            disabled={isDisconnecting}
          >
            {tCommon("syncNow")}
          </Button>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={isSyncing || isDisconnecting}
            className="text-sm text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
          >
            {isDisconnecting ? tCommon("disconnecting") : tCommon("disconnect")}
          </button>
        </div>
      </div>
    </Card>
  );
}
