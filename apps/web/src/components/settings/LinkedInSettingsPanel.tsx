"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, Input, Avatar, InlineBanner } from "@/components/ui";
import { LinkedInIcon } from "@/components/shared/LinkedInIcon";
import { optionalLinkedInProfileUrlSchema } from "@/lib/alumni/linkedin-url";
import { showFeedback } from "@/lib/feedback/show-feedback";
import {
  LINKEDIN_OIDC_SOURCE,
  type LinkedInConnectionSource,
} from "@/lib/linkedin/connection-source";
import { getManualLinkedInSyncState } from "@/lib/linkedin/manual-sync-state";

export interface LinkedInEnrichment {
  jobTitle: string | null;
  currentCompany: string | null;
  school: string | null;
}

export type LinkedInEnrichmentStatus = "pending" | "syncing" | "enriched" | "failed";

export interface LinkedInConnection {
  source: LinkedInConnectionSource;
  status: "connected" | "disconnected" | "error";
  linkedInName: string | null;
  linkedInEmail: string | null;
  linkedInPhotoUrl: string | null;
  lastSyncAt: string | null;
  syncError: string | null;
  enrichment?: LinkedInEnrichment | null;
  enrichmentStatus?: LinkedInEnrichmentStatus | null;
}

export interface LinkedInSettingsPanelProps {
  linkedInUrl: string;
  onLinkedInUrlSave: (url: string) => Promise<void>;
  connection: LinkedInConnection | null;
  isConnected: boolean;
  connectionLoading: boolean;
  oauthAvailable: boolean;
  enrichmentConfigured: boolean;
  resyncEnabled: boolean;
  resyncIsAdmin: boolean;
  resyncRemaining: number;
  resyncMaxPerMonth: number;
  onConnect: () => void;
  onSync: () => Promise<{ message: string }>;
  onDisconnect: () => Promise<void>;
  /**
   * When rendered inside a parent that already shows the brand icon, name, and
   * connection status (e.g. the member-profile Connected Accounts accordion),
   * suppress this panel's redundant icon-title headers and status badges.
   */
  nested?: boolean;
}

function formatLastSync(lastSyncAt: string | null, neverLabel: string): string {
  if (!lastSyncAt) return neverLabel;
  return new Date(lastSyncAt).toLocaleString();
}

export function LinkedInSettingsPanel({
  linkedInUrl,
  onLinkedInUrlSave,
  connection,
  isConnected,
  connectionLoading,
  oauthAvailable,
  enrichmentConfigured,
  resyncEnabled,
  resyncIsAdmin,
  resyncRemaining,
  resyncMaxPerMonth,
  onConnect,
  onSync,
  onDisconnect,
  nested = false,
}: LinkedInSettingsPanelProps) {
  const tLinkedin = useTranslations("linkedin");
  const tCommon = useTranslations("common");

  const [urlValue, setUrlValue] = useState(linkedInUrl);
  const [urlSaving, setUrlSaving] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const [isSyncing, setIsSyncing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Keep URL in sync with prop changes
  useEffect(() => {
    setUrlValue(linkedInUrl);
  }, [linkedInUrl]);

  // Save the URL only (used when enrichment is not configured).
  const handleUrlSave = async () => {
    setUrlError(null);
    const result = optionalLinkedInProfileUrlSchema.safeParse(urlValue);
    if (!result.success) {
      setUrlError(result.error.issues[0]?.message ?? "Invalid LinkedIn URL");
      return;
    }
    setUrlSaving(true);
    try {
      await onLinkedInUrlSave(result.data ?? "");
      showFeedback(tLinkedin("urlSaved"), "success", { duration: 5000 });
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : tLinkedin("failedSaveUrl"));
    } finally {
      setUrlSaving(false);
    }
  };

  // The one sync action: persist the URL if it changed, then start the async run.
  const handleSync = async () => {
    setUrlError(null);
    const trimmed = urlValue.trim();
    if (trimmed !== (linkedInUrl ?? "").trim()) {
      const result = optionalLinkedInProfileUrlSchema.safeParse(urlValue);
      if (!result.success) {
        setUrlError(result.error.issues[0]?.message ?? "Invalid LinkedIn URL");
        return;
      }
      setIsSyncing(true);
      try {
        await onLinkedInUrlSave(result.data ?? "");
      } catch (err) {
        setUrlError(err instanceof Error ? err.message : tLinkedin("failedSaveUrl"));
        setIsSyncing(false);
        return;
      }
    } else {
      setIsSyncing(true);
    }

    try {
      const result = await onSync();
      showFeedback(result.message, "success", { duration: 5000 });
    } catch (err) {
      showFeedback(err instanceof Error ? err.message : tLinkedin("failedSync"), "error", { duration: 5000 });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm(tLinkedin("disconnectConfirm"))) return;
    setIsDisconnecting(true);
    try {
      await onDisconnect();
    } catch (err) {
      showFeedback(err instanceof Error ? err.message : tLinkedin("failedDisconnect"), "error", { duration: 5000 });
    } finally {
      setIsDisconnecting(false);
    }
  };

  const isOidcLoginOnly = connection?.source === LINKEDIN_OIDC_SOURCE;
  const enrichment = connection?.enrichment;
  const hasEnrichmentPreview = !!enrichment && (!!enrichment.jobTitle || !!enrichment.currentCompany || !!enrichment.school);

  // Gate the single sync button on the *current* input value (reflects a URL the
  // user just typed but hasn't saved yet) plus quota / configuration.
  const manualSyncState = getManualLinkedInSyncState({
    linkedInUrl: urlValue,
    enrichmentConfigured,
    resyncEnabled,
    resyncIsAdmin,
    resyncRemaining,
    resyncMaxPerMonth,
  });
  const syncBusy = isSyncing || urlSaving || isDisconnecting;
  // OAuth-connected users can always sync (it also refreshes name/photo); others
  // need a valid URL. Quota/config gating comes from manualSyncState.
  const showSyncButton = enrichmentConfigured && (isConnected || manualSyncState.visible);
  const syncDisabled = syncBusy || (isConnected ? (resyncRemaining <= 0 || (!resyncEnabled && !resyncIsAdmin)) : manualSyncState.disabled);
  const quotaText = isConnected
    ? (!resyncEnabled && !resyncIsAdmin
        ? tLinkedin("resyncManaged")
        : resyncRemaining <= 0
          ? tLinkedin("limitReached")
          : tLinkedin("syncsRemaining", { remaining: resyncRemaining, max: resyncMaxPerMonth }))
    : manualSyncState.helperText;

  const renderStatusBadge = () => {
    switch (connection?.enrichmentStatus) {
      case "syncing":
      case "pending":
        return <Badge variant="primary">{tLinkedin("statusSyncing")}</Badge>;
      case "enriched":
        return <Badge variant="success">{tLinkedin("statusSynced")}</Badge>;
      case "failed":
        return <Badge variant="error">{tLinkedin("statusFailed")}</Badge>;
      default:
        return null;
    }
  };

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
      {/* Section 1: Profile URL + single Sync action */}
      <div className="p-5 space-y-3">
        {!nested && (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <LinkedInIcon />
              <p className="font-medium text-foreground">{tLinkedin("profileUrl")}</p>
            </div>
            {renderStatusBadge()}
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          {tLinkedin("profileUrlDesc")}
        </p>
        <div className="max-w-md space-y-3">
          <Input
            label={tLinkedin("profileUrlLabel")}
            type="url"
            placeholder={tLinkedin("profileUrlPlaceholder")}
            value={urlValue}
            onChange={(e) => {
              setUrlValue(e.target.value);
              setUrlError(null);
            }}
          />
          {urlError && (
            <InlineBanner variant="error">{urlError}</InlineBanner>
          )}

          {showSyncButton ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  onClick={handleSync}
                  isLoading={isSyncing}
                  disabled={syncDisabled}
                >
                  {tLinkedin("syncData")}
                </Button>
                {quotaText && (
                  <span className={`text-xs ${resyncRemaining <= 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                    {quotaText}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {tLinkedin("refreshDesc")}
              </p>
            </div>
          ) : (
            <Button
              size="sm"
              onClick={handleUrlSave}
              isLoading={urlSaving}
              disabled={urlSaving || isSyncing}
            >
              {tCommon("save")}
            </Button>
          )}

          {/* Enrichment preview */}
          {hasEnrichmentPreview && enrichment && (
            <div className="rounded-lg bg-muted/30 border border-border/40 px-4 py-3 space-y-1 text-sm">
              {(enrichment.jobTitle || enrichment.currentCompany) && (
                <p className="text-foreground">
                  {enrichment.jobTitle && <span className="font-medium">{enrichment.jobTitle}</span>}
                  {enrichment.jobTitle && enrichment.currentCompany && " at "}
                  {enrichment.currentCompany && <span>{enrichment.currentCompany}</span>}
                </p>
              )}
              {enrichment.school && (
                <p className="text-muted-foreground">{enrichment.school}</p>
              )}
            </div>
          )}

          {connection?.lastSyncAt && (
            <p className="text-xs text-muted-foreground">
              {tLinkedin("lastSyncedShort", { time: formatLastSync(connection.lastSyncAt, tCommon("never")) })}
            </p>
          )}

          {connection?.syncError && (
            <InlineBanner variant="warning">{connection.syncError}</InlineBanner>
          )}

          {!enrichmentConfigured && (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              {tLinkedin("notConfiguredSync")}
            </div>
          )}

          {/* Tip: make profile sections public for richer sync */}
          {showSyncButton && (
            <div className="text-xs text-muted-foreground/70 space-y-1">
              <p>
                <span className="font-medium text-muted-foreground">{tLinkedin("tip")}</span> {tLinkedin("publicSections")}
              </p>
              <ol className="list-decimal list-inside space-y-0.5 pl-1">
                <li>
                  Open your{" "}
                  <a
                    href="https://www.linkedin.com/public-profile/settings"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    {tLinkedin("publicSettings")}
                  </a>
                </li>
                <li>Toggle on <span className="font-medium text-muted-foreground">{tLinkedin("experience")}</span>, <span className="font-medium text-muted-foreground">{tLinkedin("education")}</span>, and <span className="font-medium text-muted-foreground">{tLinkedin("headline")}</span></li>
                <li>{tLinkedin("waitAfterChange")}</li>
                <li>{tLinkedin("comeBackSync")}</li>
              </ol>
            </div>
          )}
        </div>
      </div>

      {/* Section 2: Connection status (connected) */}
      {isConnected && connection && (
        <div className="p-5 space-y-3">
          {!nested && (
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <LinkedInIcon />
                <p className="font-medium text-foreground">{tLinkedin("connectedAccount")}</p>
              </div>
              <Badge variant="success">{tCommon("connected")}</Badge>
            </div>
          )}

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

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {tLinkedin("lastSynced", { time: formatLastSync(connection.lastSyncAt, tCommon("never")) })}
            </p>
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

      {/* Section 3: Connect prompt (disconnected) */}
      {!isConnected && (
        <div className="p-5 space-y-3">
          {nested ? (
            !oauthAvailable && (
              <Badge variant="muted">{tCommon("unavailable")}</Badge>
            )
          ) : (
            <div className="flex items-center gap-2">
              <LinkedInIcon />
              <p className="font-medium text-foreground">{tLinkedin("connection")}</p>
              {!oauthAvailable && <Badge variant="muted">{tCommon("unavailable")}</Badge>}
            </div>
          )}

          {!oauthAvailable ? (
            <p className="text-sm text-muted-foreground">
              {tLinkedin("notConfigured")}
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {tLinkedin("connectDesc")}
              </p>

              {connection?.status === "error" && !isOidcLoginOnly && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {tLinkedin("errorDesc")}
                </p>
              )}

              {isOidcLoginOnly && (
                <p className="text-sm text-muted-foreground">
                  {tLinkedin("oidcNote")}
                </p>
              )}

              <Button onClick={onConnect}>
                {connection?.status === "error"
                  ? tLinkedin("reconnect")
                  : tLinkedin("connectLinkedIn")}
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
