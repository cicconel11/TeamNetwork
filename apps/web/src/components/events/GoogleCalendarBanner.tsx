"use client";

import { useState, useCallback } from "react";
import { Card, Button } from "@/components/ui";
import { useGoogleCalendarSync } from "@/hooks/useGoogleCalendarSync";
import { GoogleCalendarSyncPanel } from "@/components/settings/GoogleCalendarSyncPanel";

interface GoogleCalendarBannerProps {
  orgId: string;
  orgSlug: string;
  orgName: string;
}

const DISMISS_KEY_PREFIX = "gcal-banner-dismissed-";

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

function GoogleCalendarIcon() {
  return (
    <svg className="w-8 h-8 flex-shrink-0" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground" />
      <path d="M3 9h18" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground" />
      <path d="M8 2v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-muted-foreground" />
      <path d="M16 2v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-muted-foreground" />
      <rect x="7" y="12" width="3" height="2.5" rx="0.5" fill="#4285F4" />
      <rect x="10.5" y="12" width="3" height="2.5" rx="0.5" fill="#EA4335" />
      <rect x="14" y="12" width="3" height="2.5" rx="0.5" fill="#FBBC04" />
      <rect x="7" y="15.5" width="3" height="2.5" rx="0.5" fill="#34A853" />
      <rect x="10.5" y="15.5" width="3" height="2.5" rx="0.5" fill="#4285F4" />
      <rect x="14" y="15.5" width="3" height="2.5" rx="0.5" fill="#EA4335" />
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

export function GoogleCalendarBanner({ orgId, orgSlug, orgName }: GoogleCalendarBannerProps) {
  const gcal = useGoogleCalendarSync({
    orgId,
    orgSlug,
    redirectPath: `/${orgSlug}/events`,
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
      await gcal.syncNow();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setIsSyncing(false);
    }
  }, [gcal]);

  // While loading connection status, render nothing (no flash, no skeleton)
  if (gcal.connectionLoading) return null;

  // If OAuth init failed (no Google env vars), hide entirely
  if (gcal.oauthError === "oauth_init_failed") return null;

  const hasErrorOrDisconnectedStatus =
    gcal.connection?.status === "error" || gcal.connection?.status === "disconnected";

  // --- OAuth callback messages ---
  const oauthBanner = gcal.oauthStatus === "connected" ? (
    <div className="mb-4 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-4 py-3 text-sm text-green-800 dark:text-green-200 animate-fade-in">
      Google Calendar connected successfully!
    </div>
  ) : gcal.oauthError ? (
    <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-800 dark:text-red-200 animate-fade-in">
      {gcal.oauthErrorMessage || "Failed to connect Google Calendar. Please try again."}
    </div>
  ) : null;

  // --- Connected: compact status strip ---
  if (gcal.isConnected) {
    return (
      <div className="mb-6 animate-fade-in">
        {oauthBanner}
        <Card className="overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <CheckIcon />
              <span className="text-sm font-medium text-foreground truncate">
                Synced to Google Calendar
              </span>
              <span className="text-sm text-muted-foreground truncate hidden sm:inline">
                {gcal.connection?.googleEmail}
              </span>
              {gcal.connection?.lastSyncAt && (
                <span className="text-xs text-muted-foreground hidden md:inline">
                  · {formatLastSync(gcal.connection.lastSyncAt)}
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
                <GoogleCalendarSyncPanel
                  orgName={orgName}
                  organizationId={orgId}
                  connection={gcal.connection}
                  isConnected={gcal.isConnected}
                  connectionLoading={false}
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
      <Card className="border-l-4 border-l-org-primary bg-amber-50/50 dark:bg-amber-950/10">
        <div className="p-5 flex items-start gap-4">
          <GoogleCalendarIcon />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-foreground text-sm">
                  Sync events to Google Calendar
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

            {gcal.connection?.status === "disconnected" && (
              <p className="text-sm text-amber-600 dark:text-amber-400 mt-2">
                Your Google Calendar was disconnected. Reconnect to resume syncing.
              </p>
            )}
            {gcal.connection?.status === "error" && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                There was an error with your Google Calendar connection. Please reconnect.
              </p>
            )}

            <div className="mt-3">
              <Button size="sm" onClick={gcal.connect}>
                {hasErrorOrDisconnectedStatus ? "Reconnect Google Calendar" : "Connect Google Calendar"}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
