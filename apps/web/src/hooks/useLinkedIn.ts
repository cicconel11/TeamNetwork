"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getLinkedInIntegrationDisabledMessage,
  LINKEDIN_INTEGRATION_DISABLED_CODE,
} from "@/lib/linkedin/config";
import { showFeedback } from "@/lib/feedback/show-feedback";
import type { LinkedInConnection } from "@/components/settings/LinkedInSettingsPanel";
import { LINKEDIN_OAUTH_SOURCE } from "@/lib/linkedin/connection-source";

interface LinkedInStatusResponse {
  linkedin_url: string | null;
  connection: LinkedInConnection | null;
  integration?: {
    oauthAvailable: boolean;
    brightDataConfigured?: boolean;
    reason: "not_configured" | null;
  };
  resync?: {
    enabled: boolean;
    is_admin: boolean;
    remaining: number;
    max_per_month: number;
  };
}

export interface UseLinkedInReturn {
  linkedInUrl: string;
  connection: LinkedInConnection | null;
  connectionLoading: boolean;
  oauthAvailable: boolean;
  brightDataConfigured: boolean;
  isConnected: boolean;
  resyncEnabled: boolean;
  resyncIsAdmin: boolean;
  resyncRemaining: number;
  resyncMaxPerMonth: number;
  onLinkedInUrlSave: (url: string) => Promise<void>;
  onConnect: () => void;
  onOauthSync: () => Promise<{ message: string }>;
  onBrightDataSync: () => Promise<{ message: string }>;
  onDisconnect: () => Promise<void>;
}

interface UseLinkedInOptions {
  redirectPath?: string;
}

export function useLinkedIn(options?: UseLinkedInOptions): UseLinkedInReturn {
  const [linkedInUrl, setLinkedInUrl] = useState("");
  const [connection, setConnection] = useState<LinkedInConnection | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [oauthAvailable, setOauthAvailable] = useState(true);
  const [brightDataConfigured, setBrightDataConfigured] = useState(false);
  const [resyncEnabled, setResyncEnabled] = useState(false);
  const [resyncIsAdmin, setResyncIsAdmin] = useState(false);
  const [resyncRemaining, setResyncRemaining] = useState(2);
  const [resyncMaxPerMonth, setResyncMaxPerMonth] = useState(2);

  // Read LinkedIn OAuth callback query params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkedinParam = params.get("linkedin");
    const warningMessage = params.get("warning_message");
    const errorParam = params.get("error");
    const errorMessage = params.get("error_message");

    if (warningMessage) {
      showFeedback(warningMessage, "warning", { duration: 8000 });
    } else if (linkedinParam === "connected") {
      showFeedback(
        "Your LinkedIn account has been connected successfully.",
        "success",
        { duration: 8000 }
      );
    } else if (errorParam) {
      const fallbackMessage =
        errorParam === LINKEDIN_INTEGRATION_DISABLED_CODE
          ? getLinkedInIntegrationDisabledMessage()
          : "An error occurred connecting your LinkedIn account.";
      if (errorParam === LINKEDIN_INTEGRATION_DISABLED_CODE) {
        setOauthAvailable(false);
      }
      showFeedback(errorMessage || fallbackMessage, "error", { duration: 8000 });
    }

    // Clean stale LinkedIn query params from URL
    if (linkedinParam || warningMessage || errorParam) {
      const url = new URL(window.location.href);
      url.searchParams.delete("linkedin");
      url.searchParams.delete("warning");
      url.searchParams.delete("warning_message");
      url.searchParams.delete("error");
      url.searchParams.delete("error_message");
      window.history.replaceState({}, "", url.pathname);
    }
  }, []);

  const refreshLinkedInStatus = useCallback(async () => {
    setConnectionLoading(true);
    try {
      const res = await fetch("/api/user/linkedin/status");
      if (res.status === 401) {
        return;
      }
      if (!res.ok) {
        return;
      }
      const data = (await res.json()) as LinkedInStatusResponse;
      setLinkedInUrl(data.linkedin_url ?? "");
      setConnection(data.connection ?? null);
      setOauthAvailable(data.integration?.oauthAvailable ?? true);
      setBrightDataConfigured(data.integration?.brightDataConfigured ?? false);
      if (data.resync) {
        setResyncEnabled(data.resync.enabled);
        setResyncIsAdmin(data.resync.is_admin ?? false);
        setResyncRemaining(data.resync.remaining);
        setResyncMaxPerMonth(data.resync.max_per_month);
      }
    } catch {
      // Silently continue — panel will show its own loading/error state
    } finally {
      setConnectionLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshLinkedInStatus();
  }, [refreshLinkedInStatus]);

  const isConnected =
    connection?.source === LINKEDIN_OAUTH_SOURCE && connection?.status === "connected";

  const onLinkedInUrlSave = useCallback(async (url: string) => {
    const res = await fetch("/api/user/linkedin/url", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkedin_url: url }),
    });

    if (res.status === 404) {
      throw new Error("This feature is not yet available");
    }
    if (res.status === 401) {
      throw new Error("You need to sign in again");
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error ?? "Failed to save URL");
    }

    setLinkedInUrl(url);
    await refreshLinkedInStatus();
  }, [refreshLinkedInStatus]);

  const onConnect = useCallback(async () => {
    try {
      const res = await fetch("/api/user/linkedin/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirectPath: options?.redirectPath }),
      });

      if (res.status === 404) {
        showFeedback("LinkedIn integration is not yet available.", "error", {
          duration: 8000,
        });
        return;
      }
      if (res.status === 401) {
        showFeedback("You need to sign in again.", "error", { duration: 8000 });
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (
          res.status === 503 ||
          (data as { code?: string }).code === LINKEDIN_INTEGRATION_DISABLED_CODE
        ) {
          setOauthAvailable(false);
        }
        showFeedback(
          (data as { error?: string }).error ?? "Failed to start LinkedIn connection.",
          "error",
          { duration: 8000 }
        );
        return;
      }

      const data = await res.json();
      if ((data as { redirectUrl?: string }).redirectUrl) {
        window.location.href = (data as { redirectUrl: string }).redirectUrl;
      }
    } catch {
      showFeedback(
        "Unable to reach the server. Please try again.",
        "error",
        { duration: 8000 }
      );
    }
  }, [options?.redirectPath]);

  const handleSyncResponse = useCallback(async (res: Response) => {
    if (res.status === 404) {
      throw new Error("This feature is not yet available");
    }
    if (res.status === 401) {
      throw new Error("You need to sign in again");
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      await refreshLinkedInStatus();
      throw new Error((data as { error?: string }).error ?? "Failed to sync");
    }

    const data = await res.json();
    const syncData = data as { message?: string; remaining_syncs?: number };
    if (typeof syncData.remaining_syncs === "number") {
      setResyncRemaining(syncData.remaining_syncs);
    }
    await refreshLinkedInStatus();

    return { message: syncData.message ?? "LinkedIn profile synced" };
  }, [refreshLinkedInStatus]);

  const onOauthSync = useCallback(async () => {
    const res = await fetch("/api/user/linkedin/sync", { method: "POST" });
    return handleSyncResponse(res);
  }, [handleSyncResponse]);

  const onBrightDataSync = useCallback(async () => {
    const res = await fetch("/api/user/linkedin/bright-data-sync", { method: "POST" });
    return handleSyncResponse(res);
  }, [handleSyncResponse]);

  const onDisconnect = useCallback(async () => {
    const res = await fetch("/api/user/linkedin/disconnect", { method: "POST" });

    if (res.status === 404) {
      throw new Error("This feature is not yet available");
    }
    if (res.status === 401) {
      throw new Error("You need to sign in again");
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error ?? "Failed to disconnect");
    }

    // Optimistic clear so the UI reflects disconnect immediately even if the
    // follow-up status fetch fails (transient 401/500/network error).
    setConnection(null);
    await refreshLinkedInStatus();
  }, [refreshLinkedInStatus]);

  return {
    linkedInUrl,
    connection,
    connectionLoading,
    oauthAvailable,
    brightDataConfigured,
    isConnected,
    resyncEnabled,
    resyncIsAdmin,
    resyncRemaining,
    resyncMaxPerMonth,
    onLinkedInUrlSave,
    onConnect,
    onOauthSync,
    onBrightDataSync,
    onDisconnect,
  };
}
