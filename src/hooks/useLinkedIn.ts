"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getLinkedInIntegrationDisabledMessage,
  LINKEDIN_INTEGRATION_DISABLED_CODE,
} from "@/lib/linkedin/config";
import { showFeedback } from "@/lib/feedback/show-feedback";
import type { LinkedInConnection } from "@/components/settings/LinkedInSettingsPanel";

interface LinkedInStatusResponse {
  linkedin_url: string | null;
  connection: LinkedInConnection | null;
  integration?: {
    oauthAvailable: boolean;
    reason: "not_configured" | null;
  };
}

export interface UseLinkedInReturn {
  linkedInUrl: string;
  connection: LinkedInConnection | null;
  connectionLoading: boolean;
  oauthAvailable: boolean;
  isConnected: boolean;
  onLinkedInUrlSave: (url: string) => Promise<void>;
  onConnect: () => void;
  onSync: () => Promise<{ message: string }>;
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
    connection?.source === "oauth" && connection?.status === "connected";

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
  }, []);

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

  const onSync = useCallback(async () => {
    const res = await fetch("/api/user/linkedin/sync", { method: "POST" });

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
    await refreshLinkedInStatus();

    return { message: (data as { message?: string }).message ?? "LinkedIn profile synced" };
  }, [refreshLinkedInStatus]);

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

    setConnection(null);
    await refreshLinkedInStatus();
  }, [refreshLinkedInStatus]);

  return {
    linkedInUrl,
    connection,
    connectionLoading,
    oauthAvailable,
    isConnected,
    onLinkedInUrlSave,
    onConnect,
    onSync,
    onDisconnect,
  };
}
