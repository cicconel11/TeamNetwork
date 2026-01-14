"use client";

import { useState } from "react";
import { Card, Button, Badge } from "@/components/ui";

interface CalendarConnection {
  googleEmail: string;
  status: "connected" | "disconnected" | "error";
  lastSyncAt: string | null;
}

interface CalendarConnectionCardProps {
  connection: CalendarConnection | null;
  isLoading?: boolean;
  onConnect: () => void;
  onDisconnect: () => Promise<void>;
  onSync?: () => Promise<void>;
}

/**
 * CalendarConnectionCard component
 * 
 * Displays Google Calendar connection status and provides connect/disconnect actions.
 * 
 * Requirements: 1.1, 1.4, 6.1
 * - Displays option to connect Google Calendar
 * - Shows connected Google email and disconnect option
 * - Displays current connection status and last successful sync time
 */
export function CalendarConnectionCard({
  connection,
  isLoading = false,
  onConnect,
  onDisconnect,
  onSync,
}: CalendarConnectionCardProps) {
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    setError(null);
    try {
      await onDisconnect();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleSync = async () => {
    if (!onSync) return;
    setIsSyncing(true);
    setError(null);
    try {
      await onSync();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync");
    } finally {
      setIsSyncing(false);
    }
  };

  const formatLastSync = (lastSyncAt: string | null): string => {
    if (!lastSyncAt) return "Never";
    const date = new Date(lastSyncAt);
    return date.toLocaleString();
  };

  const getStatusBadge = (status: CalendarConnection["status"]) => {
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
  };

  if (isLoading) {
    return (
      <Card className="p-5">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-muted rounded w-1/3"></div>
          <div className="h-4 bg-muted rounded w-2/3"></div>
        </div>
      </Card>
    );
  }

  const isConnected = connection?.status === "connected";

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <svg
              className="w-5 h-5 text-foreground"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm-8 4H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z" />
            </svg>
            <p className="font-medium text-foreground">Google Calendar</p>
          </div>
          <p className="text-sm text-muted-foreground">
            {isConnected
              ? "Sync organization events to your Google Calendar automatically."
              : "Connect your Google Calendar to automatically sync organization events."}
          </p>
        </div>
        {connection && getStatusBadge(connection.status)}
      </div>

      {isConnected && connection && (
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Connected as:</span>
            <span className="font-medium text-foreground">{connection.googleEmail}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Last synced:</span>
            <span className="text-foreground">{formatLastSync(connection.lastSyncAt)}</span>
          </div>
        </div>
      )}

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

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
      )}

      <div className="flex items-center gap-3">
        {isConnected ? (
          <>
            {onSync && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSync}
                isLoading={isSyncing}
                disabled={isDisconnecting}
              >
                Sync Now
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDisconnect}
              isLoading={isDisconnecting}
              disabled={isSyncing}
            >
              Disconnect
            </Button>
          </>
        ) : (
          <Button onClick={onConnect} size="sm">
            Connect Google Calendar
          </Button>
        )}
      </div>
    </Card>
  );
}
