"use client";

import { useState, useEffect } from "react";
import { Badge, Button, Card, Input, Avatar, InlineBanner } from "@/components/ui";
import { LinkedInIcon } from "@/components/shared/LinkedInIcon";
import { optionalLinkedInProfileUrlSchema } from "@/lib/alumni/linkedin-url";
import { showFeedback } from "@/lib/feedback/show-feedback";

export interface LinkedInConnection {
  status: "connected" | "disconnected" | "error";
  linkedInName: string | null;
  linkedInEmail: string | null;
  linkedInPhotoUrl: string | null;
  lastSyncAt: string | null;
  syncError: string | null;
}

export interface LinkedInSettingsPanelProps {
  linkedInUrl: string;
  onLinkedInUrlSave: (url: string) => Promise<void>;
  connection: LinkedInConnection | null;
  isConnected: boolean;
  connectionLoading: boolean;
  oauthAvailable: boolean;
  onConnect: () => void;
  onSync: () => Promise<{ message: string }>;
  onDisconnect: () => Promise<void>;
}

function formatLastSync(lastSyncAt: string | null): string {
  if (!lastSyncAt) return "Never";
  return new Date(lastSyncAt).toLocaleString();
}

export function LinkedInSettingsPanel({
  linkedInUrl,
  onLinkedInUrlSave,
  connection,
  isConnected,
  connectionLoading,
  oauthAvailable,
  onConnect,
  onSync,
  onDisconnect,
}: LinkedInSettingsPanelProps) {
  const [urlValue, setUrlValue] = useState(linkedInUrl);
  const [urlSaving, setUrlSaving] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const [isSyncing, setIsSyncing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Keep URL in sync with prop changes
  useEffect(() => {
    setUrlValue(linkedInUrl);
  }, [linkedInUrl]);

  const handleUrlSave = async () => {
    setUrlError(null);

    // Validate client-side
    const result = optionalLinkedInProfileUrlSchema.safeParse(urlValue);
    if (!result.success) {
      setUrlError(result.error.issues[0]?.message ?? "Invalid LinkedIn URL");
      return;
    }

    setUrlSaving(true);
    try {
      await onLinkedInUrlSave(result.data ?? "");
      showFeedback("LinkedIn URL saved", "success", { duration: 5000 });
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : "Failed to save URL");
    } finally {
      setUrlSaving(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await onSync();
      showFeedback(result.message, "success", { duration: 5000 });
    } catch (err) {
      showFeedback(err instanceof Error ? err.message : "Failed to sync", "error", { duration: 5000 });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect your LinkedIn account? Your manual profile URL will be kept.")) return;
    setIsDisconnecting(true);
    try {
      await onDisconnect();
    } catch (err) {
      showFeedback(err instanceof Error ? err.message : "Failed to disconnect", "error", { duration: 5000 });
    } finally {
      setIsDisconnecting(false);
    }
  };

  const canRetrySync = connection?.status === "error";

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

  return (
    <Card className="divide-y divide-border/60">
      {/* Section 1: Manual URL */}
      <div className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <LinkedInIcon />
          <p className="font-medium text-foreground">LinkedIn Profile URL</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Add your LinkedIn profile URL so others in your organization can find you.
        </p>
        <div className="max-w-md space-y-3">
          <Input
            label="Profile URL"
            type="url"
            placeholder="https://www.linkedin.com/in/yourname"
            value={urlValue}
            onChange={(e) => {
              setUrlValue(e.target.value);
              setUrlError(null);
            }}
          />
          {urlError && (
            <InlineBanner variant="error">{urlError}</InlineBanner>
          )}
          <Button
            size="sm"
            onClick={handleUrlSave}
            isLoading={urlSaving}
            disabled={urlSaving}
          >
            Save
          </Button>
        </div>
      </div>

      {/* Section 2: Connection status (connected) */}
      {isConnected && connection && (
        <div className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              <LinkedInIcon />
              <p className="font-medium text-foreground">Connected Account</p>
            </div>
            <Badge variant="success">Connected</Badge>
          </div>

          <div className="flex items-center gap-3">
            <Avatar
              src={connection.linkedInPhotoUrl}
              name={connection.linkedInName ?? undefined}
              size="md"
            />
            <div className="space-y-0.5 text-sm">
              {connection.linkedInName && (
                <p className="font-medium text-foreground">{connection.linkedInName}</p>
              )}
              {connection.linkedInEmail && (
                <p className="text-muted-foreground">{connection.linkedInEmail}</p>
              )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Last synced: {formatLastSync(connection.lastSyncAt)}
          </p>

          {connection.syncError && (
            <InlineBanner variant="warning">{connection.syncError}</InlineBanner>
          )}
        </div>
      )}

      {/* Section 3: Connect prompt (disconnected) */}
      {!isConnected && (
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <LinkedInIcon />
            <p className="font-medium text-foreground">LinkedIn Connection</p>
            {!oauthAvailable && <Badge variant="muted">Unavailable</Badge>}
          </div>

          {!oauthAvailable ? (
            <p className="text-sm text-muted-foreground">
              LinkedIn integration is not configured in this environment. You can still save your
              profile URL above to share it with your organization.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Connect your LinkedIn account to automatically sync your profile
                photo, name, and headline to your organization profile.
              </p>

              {connection?.status === "error" && (
                <div className="space-y-3">
                  <p className="text-sm text-red-600 dark:text-red-400">
                    There was an error with your LinkedIn connection. Try syncing again first.
                    If it keeps failing, reconnect LinkedIn.
                  </p>
                  <div className="flex items-center gap-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleSync}
                      isLoading={isSyncing}
                      disabled={isDisconnecting}
                    >
                      Sync Now
                    </Button>
                    <Button
                      size="sm"
                      onClick={onConnect}
                      disabled={isSyncing}
                    >
                      Reconnect LinkedIn
                    </Button>
                  </div>
                </div>
              )}

              {!canRetrySync && (
                <Button onClick={onConnect}>
                  Connect LinkedIn
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {/* Section 4: Actions (connected) */}
      {isConnected && (
        <div className="p-5 space-y-3">
          {!oauthAvailable && (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              LinkedIn integration is not configured in this environment. You can disconnect this
              account, but syncing is unavailable until configuration is restored.
            </div>
          )}
          <div className="flex items-center justify-between">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSync}
              isLoading={isSyncing}
              disabled={!oauthAvailable || isDisconnecting}
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
      )}
    </Card>
  );
}
