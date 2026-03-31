"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, InlineBanner } from "@/components/ui";
import { showFeedback } from "@/lib/feedback/show-feedback";

interface SyncError {
  phase: string;
  code: string;
  message: string;
  at: string;
}

interface IntegrationData {
  status: "active" | "error" | "disconnected";
  lastSyncedAt: string | null;
  lastSyncCount: number | null;
  lastSyncError: SyncError | null;
}

interface SyncLogData {
  status: string;
  recordsCreated: number;
  recordsUpdated: number;
  recordsUnchanged: number;
  recordsSkipped: number;
  completedAt: string | null;
}

export interface BlackbaudSettingsPanelProps {
  orgSlug: string;
  orgId: string;
  integration: IntegrationData | null;
  lastSyncLog: SyncLogData | null;
  loading: boolean;
  blackbaudAvailable: boolean;
}

function formatLastSync(lastSyncedAt: string | null, neverLabel: string): string {
  if (!lastSyncedAt) return neverLabel;
  return new Date(lastSyncedAt).toLocaleString();
}

function formatSyncErrorMessage(error: SyncError, tBlackbaud: ReturnType<typeof useTranslations>): string {
  if (error.code === "QUOTA_EXHAUSTED") {
    const retryMatch = error.message.match(/resets? in (\d{2}:\d{2}:\d{2})/i);
    if (retryMatch) {
      return tBlackbaud("quotaReachedTime", { time: retryMatch[1] }) as string;
    }
    return tBlackbaud("quotaReached") as string;
  }
  if (error.code === "VERIFY_FAILED" && error.message.includes("quota")) {
    return tBlackbaud("quotaReached") as string;
  }
  if (error.code === "VERIFY_FAILED") {
    return tBlackbaud("cannotVerify") as string;
  }
  return error.message;
}

function BlackbaudIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-5 h-5"} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
    </svg>
  );
}

export function BlackbaudSettingsPanel({
  orgSlug,
  orgId,
  integration,
  lastSyncLog,
  loading,
  blackbaudAvailable,
}: BlackbaudSettingsPanelProps) {
  const tBlackbaud = useTranslations("blackbaud");
  const tCommon = useTranslations("common");

  const [isSyncing, setIsSyncing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleConnect = () => {
    window.location.href = `/api/blackbaud/auth?orgSlug=${orgSlug}`;
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch(`/api/organizations/${orgId}/integrations/blackbaud/sync`, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429 || data?.result?.error?.toLowerCase().includes("quota")) {
          showFeedback(
            tBlackbaud("quotaReachedReset"),
            "error",
            { duration: 8000 }
          );
          return;
        }
        if (data?.result?.error === "Sync already in progress") {
          showFeedback(
            tBlackbaud("alreadyRunning"),
            "error",
            { duration: 5000 }
          );
          return;
        }
        throw new Error(data?.result?.error || data?.error || (tBlackbaud("syncFailed") as string));
      }

      const result = data.result;
      showFeedback(
        tBlackbaud("syncComplete", { created: result.created, updated: result.updated }),
        "success",
        { duration: 5000 }
      );
      window.location.reload();
    } catch (err) {
      showFeedback(
        err instanceof Error ? err.message : (tBlackbaud("syncFailed") as string),
        "error",
        { duration: 5000 }
      );
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm(tBlackbaud("disconnectConfirm") as string)) return;
    setIsDisconnecting(true);
    try {
      const res = await fetch(`/api/blackbaud/disconnect?orgSlug=${orgSlug}`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || (tBlackbaud("failedDisconnect") as string));
      }
      showFeedback(tBlackbaud("disconnectedMsg"), "success", { duration: 5000 });
      window.location.reload();
    } catch (err) {
      showFeedback(
        err instanceof Error ? err.message : (tBlackbaud("failedDisconnect") as string),
        "error",
        { duration: 5000 }
      );
    } finally {
      setIsDisconnecting(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-5">
        <div className="animate-pulse space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 bg-muted rounded" />
            <div className="h-5 bg-muted rounded w-48" />
          </div>
          <div className="h-4 bg-muted rounded w-2/3" />
          <div className="h-9 bg-muted rounded w-40" />
        </div>
      </Card>
    );
  }

  const isConnected = integration?.status === "active";
  const isError = integration?.status === "error";
  const isDisconnected = !integration || integration.status === "disconnected";

  return (
    <Card className="divide-y divide-border/60">
      {/* Header section */}
      <div className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <BlackbaudIcon className="w-5 h-5 text-foreground" />
            <p className="font-medium text-foreground">{tBlackbaud("title")}</p>
          </div>
          {isConnected && <Badge variant="success">{tCommon("connected")}</Badge>}
          {isError && <Badge variant="error">{tCommon("error")}</Badge>}
          {isDisconnected && !blackbaudAvailable && <Badge variant="muted">{tCommon("unavailable")}</Badge>}
        </div>

        {isDisconnected && (
          <>
            {!blackbaudAvailable ? (
              <p className="text-sm text-muted-foreground">
                {tBlackbaud("notConfigured")}
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {tBlackbaud("connectDesc")}
                </p>
                <Button onClick={handleConnect}>{tBlackbaud("connect")}</Button>
              </>
            )}
          </>
        )}

        {isConnected && (
          <>
            <p className="text-xs text-muted-foreground">
              {integration.lastSyncCount !== null
                ? tBlackbaud("lastSyncedRecords", {
                    time: formatLastSync(integration.lastSyncedAt, tCommon("never")),
                    count: integration.lastSyncCount,
                  })
                : `Last synced: ${formatLastSync(integration.lastSyncedAt, tCommon("never"))}`}
            </p>
          </>
        )}

        {isError && integration.lastSyncError && (
          <InlineBanner variant="error">
            {formatSyncErrorMessage(integration.lastSyncError, tBlackbaud)}
          </InlineBanner>
        )}

        {isConnected && integration.lastSyncError && (
          <InlineBanner variant="warning">
            Last sync issue: {formatSyncErrorMessage(integration.lastSyncError, tBlackbaud)}
          </InlineBanner>
        )}
      </div>

      {/* Sync details section (connected or error) */}
      {!isDisconnected && lastSyncLog && (
        <div className="p-5 space-y-3">
          <p className="text-sm font-medium text-foreground">{tBlackbaud("lastSyncDetails")}</p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground">{tBlackbaud("created")}</p>
              <p className="font-medium text-foreground">{lastSyncLog.recordsCreated}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{tBlackbaud("updated")}</p>
              <p className="font-medium text-foreground">{lastSyncLog.recordsUpdated}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{tBlackbaud("unchanged")}</p>
              <p className="font-medium text-foreground">{lastSyncLog.recordsUnchanged}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{tBlackbaud("skipped")}</p>
              <p className="font-medium text-foreground">{lastSyncLog.recordsSkipped}</p>
            </div>
          </div>
          {lastSyncLog.completedAt && (
            <p className="text-xs text-muted-foreground">
              {tBlackbaud("completed", { time: new Date(lastSyncLog.completedAt).toLocaleString() })}
            </p>
          )}
        </div>
      )}

      {/* Actions section (connected or error) */}
      {!isDisconnected && (
        <div className="p-5">
          <div className="flex items-center justify-between">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSync}
              isLoading={isSyncing}
              disabled={isDisconnecting}
            >
              {isError ? tBlackbaud("retrySyncBtn") : tCommon("syncNow")}
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
      )}
    </Card>
  );
}
