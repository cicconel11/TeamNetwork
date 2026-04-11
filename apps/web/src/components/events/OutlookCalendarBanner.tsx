"use client";

import { useState, useCallback } from "react";
import { Card, Button } from "@/components/ui";
import { useOutlookCalendarSync } from "@/hooks/useOutlookCalendarSync";
import { OutlookCalendarSyncPanel } from "@/components/settings/OutlookCalendarSyncPanel";
import { calendarEventsPath } from "@/lib/calendar/routes";

interface OutlookCalendarBannerProps {
  orgId: string;
  orgSlug: string;
  orgName: string;
}

const DISMISS_KEY_PREFIX = "outlook-cal-banner-dismissed-";

function getDismissed(orgId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(`${DISMISS_KEY_PREFIX}${orgId}`) === "1";
  } catch {
    return false;
  }
}

function setDismissed(orgId: string) {
  try {
    localStorage.setItem(`${DISMISS_KEY_PREFIX}${orgId}`, "1");
  } catch {
    // localStorage may be unavailable
  }
}

function MicrosoftCalendarIcon() {
  return (
    <svg className="w-8 h-8 flex-shrink-0" viewBox="0 0 21 21" fill="none">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function formatLastSync(lastSyncAt: string | null): string {
  if (!lastSyncAt) return "Never";
  const date = new Date(lastSyncAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString();
}

export function OutlookCalendarBanner({ orgId, orgSlug, orgName }: OutlookCalendarBannerProps) {
  const ocal = useOutlookCalendarSync({
    orgId,
    orgSlug,
    redirectPath: calendarEventsPath(orgSlug),
  });

  const [isDismissed, setIsDismissed] = useState(() => getDismissed(orgId));
  const [manageExpanded, setManageExpanded] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleDismiss = useCallback(() => {
    setDismissed(orgId);
    setIsDismissed(true);
  }, [orgId]);

  const handleSyncNow = useCallback(async () => {
    setIsSyncing(true);
    setSyncError(null);
    try {
      await ocal.syncNow();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setIsSyncing(false);
    }
  }, [ocal]);

  // While loading, render nothing
  if (ocal.connectionLoading) return null;

  const hasErrorOrDisconnectedStatus =
    ocal.connection?.status === "error" ||
    ocal.connection?.status === "disconnected" ||
    ocal.connection?.status === "reconnect_required";

  // --- OAuth callback messages ---
  const oauthBanner = ocal.oauthStatus === "connected" ? (
    <div className="mb-4 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-4 py-3 text-sm text-green-800 dark:text-green-200 animate-fade-in">
      Outlook Calendar connected successfully!
    </div>
  ) : ocal.oauthError ? (
    <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-800 dark:text-red-200 animate-fade-in">
      {ocal.oauthErrorMessage || "Failed to connect Outlook Calendar. Please try again."}
    </div>
  ) : null;

  // --- Connected: compact status strip ---
  if (ocal.isConnected) {
    return (
      <div className="mb-6 animate-fade-in">
        {oauthBanner}
        <Card className="overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <CheckIcon />
              <span className="text-sm font-medium text-foreground truncate">
                Synced to Outlook Calendar
              </span>
              <span className="text-sm text-muted-foreground truncate hidden sm:inline">
                {ocal.connection?.providerEmail}
              </span>
              {ocal.connection?.lastSyncAt && (
                <span className="text-xs text-muted-foreground hidden md:inline">
                  · {formatLastSync(ocal.connection.lastSyncAt)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSyncNow}
                isLoading={isSyncing}
              >
                Sync Now
              </Button>
              <button
                type="button"
                onClick={() => setManageExpanded(!manageExpanded)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
              >
                {manageExpanded ? "Close" : "Manage"}
              </button>
            </div>
          </div>

          {syncError && (
            <div className="px-4 pb-3 text-sm text-red-600 dark:text-red-400">
              {syncError}
            </div>
          )}

          {/* Expandable manage panel */}
          <div
            className="transition-[grid-template-rows] duration-300 ease-in-out grid"
            style={{ gridTemplateRows: manageExpanded ? "1fr" : "0fr" }}
          >
            <div className="overflow-hidden">
              <div className="border-t border-border/60">
                <OutlookCalendarSyncPanel
                  orgName={orgName}
                  organizationId={orgId}
                  connection={ocal.connection}
                  isConnected={ocal.isConnected}
                  connectionLoading={false}
                  calendars={ocal.calendars}
                  calendarsLoading={ocal.calendarsLoading}
                  targetCalendarId={ocal.targetCalendarId}
                  preferences={ocal.preferences}
                  preferencesLoading={ocal.preferencesLoading}
                  reconnectRequired={ocal.reconnectRequired}
                  onConnect={ocal.connect}
                  onDisconnect={ocal.disconnect}
                  onSync={ocal.syncNow}
                  onReconnect={ocal.reconnect}
                  onTargetCalendarChange={ocal.setTargetCalendar}
                  onPreferenceChange={ocal.updatePreferences}
                />
              </div>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // --- Disconnected: CTA banner ---

  // If dismissed and no error/disconnected status, hide
  if (isDismissed && !hasErrorOrDisconnectedStatus) return null;

  return (
    <div className="mb-6 animate-fade-in">
      {oauthBanner}
      <Card className="border-l-4 border-l-[#0078D4] bg-blue-50/30 dark:bg-blue-950/10">
        <div className="p-5 flex items-start gap-4">
          <MicrosoftCalendarIcon />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-foreground text-sm">
                  Sync events to Outlook Calendar
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Keep your team schedule up to date. Games, meetings, socials — always in sync.
                </p>
              </div>
              {!hasErrorOrDisconnectedStatus && (
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1 -mt-1 -mr-1 flex-shrink-0"
                  aria-label="Dismiss"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {ocal.connection?.status === "disconnected" && (
              <p className="text-sm text-amber-600 dark:text-amber-400 mt-2">
                Your Outlook Calendar was disconnected. Reconnect to resume syncing.
              </p>
            )}
            {ocal.connection?.status === "reconnect_required" && (
              <p className="text-sm text-amber-600 dark:text-amber-400 mt-2">
                Your Outlook connection needs re-authorization. Please reconnect.
              </p>
            )}
            {ocal.connection?.status === "error" && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                There was an error with your Outlook Calendar connection. Please reconnect.
              </p>
            )}

            <div className="mt-3">
              <Button size="sm" onClick={ocal.connect}>
                {hasErrorOrDisconnectedStatus ? "Reconnect Outlook Calendar" : "Connect Outlook Calendar"}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
