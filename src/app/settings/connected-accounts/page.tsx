"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  getLinkedInIntegrationDisabledMessage,
  LINKEDIN_INTEGRATION_DISABLED_CODE,
} from "@/lib/linkedin/config";
import { Card, Button, Badge } from "@/components/ui";
import { LinkedInIcon } from "@/components/shared/LinkedInIcon";

interface LinkedInConnectionState {
  linkedinEmail: string | null;
  linkedInName: string | null;
  linkedinPictureUrl: string | null;
  status: "connected" | "disconnected" | "error";
  lastSyncedAt: string | null;
  syncError: string | null;
}

interface LinkedInStatusResponse {
  linkedin_url: string | null;
  connection: {
    status: "connected" | "disconnected" | "error";
    linkedInName: string | null;
    linkedInEmail: string | null;
    linkedInPhotoUrl: string | null;
    lastSyncAt: string | null;
    syncError: string | null;
  } | null;
  integration?: {
    oauthAvailable: boolean;
    reason: "not_configured" | null;
  };
}

export default function ConnectedAccountsPage() {
  return (
    <Suspense fallback={<ConnectedAccountsLoading />}>
      <ConnectedAccountsContent />
    </Suspense>
  );
}

function ConnectedAccountsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Settings</p>
        <h1 className="text-2xl font-bold text-foreground">Connected Accounts</h1>
        <p className="text-muted-foreground">
          Manage third-party accounts linked to your profile.
        </p>
      </div>
      <Card className="p-5 text-sm text-muted-foreground">Loading...</Card>
    </div>
  );
}

function ConnectedAccountsContent() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<LinkedInConnectionState | null>(null);
  const [oauthAvailable, setOauthAvailable] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "warning"; message: string } | null>(null);

  // Check URL params for success/error feedback
  useEffect(() => {
    const linkedinStatus = searchParams.get("linkedin");
    const warningMessage = searchParams.get("warning_message");
    const error = searchParams.get("error");
    const errorMessage = searchParams.get("error_message");

    if (warningMessage) {
      setFeedback({ type: "warning", message: warningMessage });
    } else if (linkedinStatus === "connected") {
      setFeedback({ type: "success", message: "LinkedIn connected successfully." });
    } else if (error) {
      const fallbackMessage = error === LINKEDIN_INTEGRATION_DISABLED_CODE
        ? getLinkedInIntegrationDisabledMessage()
        : "An error occurred.";
      if (error === LINKEDIN_INTEGRATION_DISABLED_CODE) {
        setOauthAvailable(false);
      }
      setFeedback({ type: "error", message: errorMessage || fallbackMessage });
    }
  }, [searchParams]);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/user/linkedin/status");
      if (res.status === 401) {
        return;
      }
      if (!res.ok) {
        setFeedback({
          type: "error",
          message: "Unable to load LinkedIn connection status.",
        });
        return;
      }

      const data = await res.json() as LinkedInStatusResponse;
      setOauthAvailable(data.integration?.oauthAvailable ?? true);

      if (data.connection) {
        setConnection({
          linkedinEmail: data.connection.linkedInEmail,
          linkedInName: data.connection.linkedInName,
          linkedinPictureUrl: data.connection.linkedInPhotoUrl,
          status: data.connection.status,
          lastSyncedAt: data.connection.lastSyncAt,
          syncError: data.connection.syncError,
        });
      } else {
        setConnection(null);
      }
    } catch {
      setFeedback({
        type: "error",
        message: "Unable to load LinkedIn connection status.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const handleSync = async () => {
    setSyncing(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/linkedin/sync", { method: "POST" });
      const data = await res.json();

      if (!res.ok || !data.success) {
        await refreshStatus();
        setFeedback({ type: "error", message: data.message || "Sync failed." });
      } else {
        await refreshStatus();
        setFeedback({ type: "success", message: "LinkedIn profile synced." });
      }
    } catch {
      setFeedback({ type: "error", message: "An error occurred while syncing." });
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/linkedin/disconnect", { method: "POST" });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setFeedback({ type: "error", message: data.message || "Disconnect failed." });
      } else {
        setConnection(null);
        setFeedback({ type: "success", message: "LinkedIn disconnected." });
      }
    } catch {
      setFeedback({ type: "error", message: "An error occurred while disconnecting." });
    } finally {
      setDisconnecting(false);
    }
  };

  const displayName = connection?.linkedInName ?? "";

  const lastSyncLabel = connection?.lastSyncedAt
    ? `Last synced ${new Date(connection.lastSyncedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })}`
    : null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Settings</p>
        <h1 className="text-2xl font-bold text-foreground">Connected Accounts</h1>
        <p className="text-muted-foreground">
          Manage third-party accounts linked to your profile.
        </p>
      </div>

      {/* Feedback banner */}
      {feedback && (
        <Card
          className={`p-4 text-sm ${
            feedback.type === "success"
              ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300"
              : feedback.type === "warning"
                ? "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
                : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
          }`}
        >
          {feedback.message}
        </Card>
      )}

      {/* LinkedIn Card */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0A66C2]">
              <LinkedInIcon className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="font-medium text-foreground">LinkedIn</p>
              <p className="text-sm text-muted-foreground">
                Sync your name and profile photo from LinkedIn.
              </p>
            </div>
          </div>
          {connection && connection.status === "connected" && (
            <Badge variant="success">Connected</Badge>
          )}
          {connection && connection.status === "error" && (
            <Badge variant="error">Error</Badge>
          )}
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : connection ? (
          <div className="space-y-3">
            {/* Profile summary */}
            <div className="flex items-center gap-3 rounded-lg bg-muted/40 border border-border p-3">
              {connection.linkedinPictureUrl && (
                <Image
                  src={connection.linkedinPictureUrl}
                  alt=""
                  width={40}
                  height={40}
                  className="h-10 w-10 rounded-full"
                />
              )}
              <div className="min-w-0">
                {displayName && (
                  <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
                )}
                {connection.linkedinEmail && (
                  <p className="text-xs text-muted-foreground truncate">{connection.linkedinEmail}</p>
                )}
              </div>
            </div>

            {lastSyncLabel && (
              <p className="text-xs text-muted-foreground">{lastSyncLabel}</p>
            )}

            {connection.syncError && (
              <Card className="border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                {connection.syncError}
              </Card>
            )}

            <p className="text-xs text-muted-foreground">
              LinkedIn connection syncs your name and photo. To display your LinkedIn profile link, enter it on your member profile.
            </p>

            <div className="flex gap-2">
              {oauthAvailable ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleSync}
                  isLoading={syncing}
                >
                  Re-sync
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  LinkedIn integration is not configured in this environment, so re-sync is unavailable.
                </p>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={handleDisconnect}
                isLoading={disconnecting}
              >
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <div>
            {oauthAvailable ? (
              <a href="/api/linkedin/auth?redirect=/settings/connected-accounts">
                <Button size="sm">Connect LinkedIn</Button>
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">
                LinkedIn integration is not configured in this environment.
              </p>
            )}
          </div>
        )}
      </Card>

      {/* Google Calendar info card */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500">
            <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div>
            <p className="font-medium text-foreground">Google Calendar</p>
            <p className="text-sm text-muted-foreground">
              Google Calendar sync is managed per-organization in the Calendar section.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
