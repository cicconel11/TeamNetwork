"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, Input, Avatar, InlineBanner } from "@/components/ui";
import { LinkedInIcon } from "@/components/shared/LinkedInIcon";
import { optionalLinkedInProfileUrlSchema } from "@/lib/alumni/linkedin-url";
import { showFeedback } from "@/lib/feedback/show-feedback";
import {
  LINKEDIN_OAUTH_SOURCE,
  LINKEDIN_OIDC_SOURCE,
  type LinkedInConnectionSource,
} from "@/lib/linkedin/connection-source";
import { getManualLinkedInSyncState } from "@/lib/linkedin/manual-sync-state";

export interface LinkedInEnrichment {
  jobTitle: string | null;
  currentCompany: string | null;
  school: string | null;
}

export interface LinkedInConnection {
  source: LinkedInConnectionSource;
  status: "connected" | "disconnected" | "error";
  linkedInName: string | null;
  linkedInEmail: string | null;
  linkedInPhotoUrl: string | null;
  lastSyncAt: string | null;
  syncError: string | null;
  enrichment?: LinkedInEnrichment | null;
}

export interface LinkedInSettingsPanelProps {
  linkedInUrl: string;
  onLinkedInUrlSave: (url: string) => Promise<void>;
  connection: LinkedInConnection | null;
  isConnected: boolean;
  connectionLoading: boolean;
  oauthAvailable: boolean;
  brightDataConfigured: boolean;
  resyncEnabled: boolean;
  resyncIsAdmin: boolean;
  resyncRemaining: number;
  resyncMaxPerMonth: number;
  onConnect: () => void;
  onOauthSync: () => Promise<{ message: string }>;
  onBrightDataSync: () => Promise<{ message: string }>;
  onDisconnect: () => Promise<void>;
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
  brightDataConfigured,
  resyncEnabled,
  resyncIsAdmin,
  resyncRemaining,
  resyncMaxPerMonth,
  onConnect,
  onOauthSync,
  onBrightDataSync,
  onDisconnect,
}: LinkedInSettingsPanelProps) {
  const tLinkedin = useTranslations("linkedin");
  const tCommon = useTranslations("common");

  const [urlValue, setUrlValue] = useState(linkedInUrl);
  const [urlSaving, setUrlSaving] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const [isOauthSyncing, setIsOauthSyncing] = useState(false);
  const [isBrightDataSyncing, setIsBrightDataSyncing] = useState(false);
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
      showFeedback(tLinkedin("urlSaved"), "success", { duration: 5000 });
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : tLinkedin("failedSaveUrl"));
    } finally {
      setUrlSaving(false);
    }
  };

  const handleOauthSync = async () => {
    setIsOauthSyncing(true);
    try {
      const result = await onOauthSync();
      showFeedback(result.message, "success", { duration: 5000 });
    } catch (err) {
      showFeedback(err instanceof Error ? err.message : tLinkedin("failedSync"), "error", { duration: 5000 });
    } finally {
      setIsOauthSyncing(false);
    }
  };

  const handleBrightDataSync = async () => {
    setIsBrightDataSyncing(true);
    try {
      const result = await onBrightDataSync();
      showFeedback(result.message, "success", { duration: 5000 });
    } catch (err) {
      showFeedback(err instanceof Error ? err.message : tLinkedin("failedSync"), "error", { duration: 5000 });
    } finally {
      setIsBrightDataSyncing(false);
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
  const canRetrySync = connection?.source === LINKEDIN_OAUTH_SOURCE && connection?.status === "error";
  const manualSyncState = getManualLinkedInSyncState({
    linkedInUrl,
    brightDataConfigured,
    resyncEnabled,
    resyncIsAdmin,
    resyncRemaining,
    resyncMaxPerMonth,
  });

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
          <p className="font-medium text-foreground">{tLinkedin("profileUrl")}</p>
        </div>
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
          <Button
            size="sm"
            onClick={handleUrlSave}
            isLoading={urlSaving}
            disabled={urlSaving || isBrightDataSyncing}
          >
            {tCommon("save")}
          </Button>
          {manualSyncState.visible && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleBrightDataSync}
                  isLoading={isBrightDataSyncing}
                  disabled={manualSyncState.disabled || urlSaving || isDisconnecting || isOauthSyncing}
                >
                  {tLinkedin("syncData")}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {manualSyncState.helperText}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {tLinkedin("refreshDesc")}
              </p>
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
            </div>
          )}
        </div>
      </div>

      {/* Section 2: Connection status (connected) */}
      {isConnected && connection && (
        <div className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              <LinkedInIcon />
              <p className="font-medium text-foreground">{tLinkedin("connectedAccount")}</p>
            </div>
            <Badge variant="success">{tCommon("connected")}</Badge>
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

          {connection.enrichment && (connection.enrichment.jobTitle || connection.enrichment.currentCompany || connection.enrichment.school) && (
            <div className="text-sm space-y-1 pt-1">
              {connection.enrichment.jobTitle && (
                <p className="text-muted-foreground">
                  <span className="text-foreground font-medium">{connection.enrichment.jobTitle}</span>
                  {connection.enrichment.currentCompany && ` at ${connection.enrichment.currentCompany}`}
                </p>
              )}
              {!connection.enrichment.jobTitle && connection.enrichment.currentCompany && (
                <p className="text-muted-foreground">{connection.enrichment.currentCompany}</p>
              )}
              {connection.enrichment.school && (
                <p className="text-muted-foreground">{connection.enrichment.school}</p>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {tLinkedin("lastSynced", { time: formatLastSync(connection.lastSyncAt, tCommon("never")) })}
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
            <p className="font-medium text-foreground">{tLinkedin("connection")}</p>
            {!oauthAvailable && <Badge variant="muted">{tCommon("unavailable")}</Badge>}
          </div>

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
                <div className="space-y-3">
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {tLinkedin("errorDesc")}
                  </p>
                  <div className="flex items-center gap-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleOauthSync}
                      isLoading={isOauthSyncing}
                      disabled={isDisconnecting || isBrightDataSyncing}
                    >
                      {tCommon("syncNow")}
                    </Button>
                    <Button
                      size="sm"
                      onClick={onConnect}
                      disabled={isOauthSyncing || isBrightDataSyncing}
                    >
                      {tLinkedin("reconnect")}
                    </Button>
                  </div>
                </div>
              )}

              {isOidcLoginOnly && (
                <p className="text-sm text-muted-foreground">
                  {tLinkedin("oidcNote")}
                </p>
              )}

              {!canRetrySync && (
                <Button onClick={onConnect}>
                  {tLinkedin("connectLinkedIn")}
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {/* Section 4: Profile Sync (connected) */}
      {isConnected && (
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M2.985 14.652" />
            </svg>
            <p className="font-medium text-foreground text-sm">{tLinkedin("profileSync")}</p>
          </div>

          {/* Enrichment data preview */}
          {connection?.enrichment && (connection.enrichment.jobTitle || connection.enrichment.currentCompany || connection.enrichment.school) && (
            <div className="rounded-lg bg-muted/30 border border-border/40 px-4 py-3 space-y-2">
              {(connection.enrichment.jobTitle || connection.enrichment.currentCompany) && (
                <div className="flex items-start gap-2.5">
                  <svg className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                  <p className="text-sm text-foreground">
                    {connection.enrichment.jobTitle && <span className="font-medium">{connection.enrichment.jobTitle}</span>}
                    {connection.enrichment.jobTitle && connection.enrichment.currentCompany && " at "}
                    {connection.enrichment.currentCompany && <span>{connection.enrichment.currentCompany}</span>}
                  </p>
                </div>
              )}
              {connection.enrichment.school && (
                <div className="flex items-start gap-2.5">
                  <svg className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342" />
                  </svg>
                  <p className="text-sm text-foreground">{connection.enrichment.school}</p>
                </div>
              )}
            </div>
          )}

          {connection?.enrichment && !connection.enrichment.jobTitle && !connection.enrichment.school && connection.lastSyncAt && (
            <InlineBanner variant="info">
              <div className="space-y-1">
                <p>{tLinkedin("missingDetails")}</p>
                <ol className="list-decimal list-inside space-y-0.5 pl-1 text-sm">
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
                  <li>Toggle on <span className="font-medium">{tLinkedin("experience")}</span>, <span className="font-medium">{tLinkedin("education")}</span>, and <span className="font-medium">{tLinkedin("headline")}</span></li>
                  <li>{tLinkedin("waitAfterChange")}</li>
                  <li>{tLinkedin("comeBackSync")}</li>
                </ol>
              </div>
            </InlineBanner>
          )}

          {connection?.lastSyncAt && (
            <p className="text-xs text-muted-foreground">
              {tLinkedin("lastSyncedShort", { time: formatLastSync(connection.lastSyncAt, tCommon("never")) })}
            </p>
          )}

          {connection?.syncError && (
            <InlineBanner variant="warning">{connection.syncError}</InlineBanner>
          )}

          {!oauthAvailable && (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              {tLinkedin("notConfiguredSync")}
            </div>
          )}

          {/* Sync button + rate limit + disconnect */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {(resyncEnabled || resyncIsAdmin) && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleOauthSync}
                  isLoading={isOauthSyncing}
                  disabled={!oauthAvailable || isDisconnecting || isBrightDataSyncing || resyncRemaining <= 0}
                >
                  {tCommon("syncNow")}
                </Button>
              )}
              {(resyncEnabled || resyncIsAdmin) && (
                <span className={`text-xs ${resyncRemaining <= 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                  {resyncRemaining <= 0
                    ? tLinkedin("limitReached")
                    : tLinkedin("syncsRemaining", { remaining: resyncRemaining, max: resyncMaxPerMonth })}
                </span>
              )}
              {!resyncEnabled && !resyncIsAdmin && oauthAvailable && (
                <span className="text-xs text-muted-foreground">
                  {tLinkedin("resyncManaged")}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={isOauthSyncing || isBrightDataSyncing || isDisconnecting}
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
