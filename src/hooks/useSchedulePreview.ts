"use client";

import { useCallback, useMemo, useState } from "react";

export type VendorType = "ics" | "vendorA" | "vendorB" | "generic_html";

export type PreviewEvent = {
  external_uid: string;
  title: string;
  start_at: string;
  end_at: string;
  location?: string;
  status?: "confirmed" | "cancelled" | "tentative";
};

export type PreviewResponse = {
  vendor: VendorType;
  title: string | null;
  eventsPreview: PreviewEvent[];
  maskedUrl: string;
};

export type AllowStatus = "active" | "pending" | "blocked" | "denied";

export type VerificationResponse = {
  vendorId: string;
  confidence: number;
  allowStatus: AllowStatus;
  evidenceSummary: string;
  maskedUrl: string;
};

type UseSchedulePreviewOptions = {
  orgId: string;
  isAdmin: boolean;
  onConnect?: () => Promise<void>;
};

export function useSchedulePreview({ orgId, isAdmin, onConnect }: UseSchedulePreviewOptions) {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [verification, setVerification] = useState<VerificationResponse | null>(null);
  const [title, setTitle] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [connectLoading, setConnectLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const previewDisabled = !url.trim() || previewLoading;

  const clearMessages = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  const resetPreview = useCallback(() => {
    setPreview(null);
    setPreviewUrl(null);
    setVerification(null);
    setTitle("");
    setError(null);
    setNotice(null);
  }, []);

  const handleUrlChange = useCallback((newUrl: string) => {
    setUrl(newUrl);
    setPreview(null);
    setPreviewUrl(null);
    setVerification(null);
    setTitle("");
    setError(null);
    setNotice(null);
  }, []);

  const handleTitleChange = useCallback((newTitle: string) => {
    setTitle(newTitle);
  }, []);

  const handlePreview = useCallback(async () => {
    if (!url.trim()) {
      setError("Paste a schedule link to preview.");
      return;
    }

    setPreviewLoading(true);
    setError(null);
    setNotice(null);
    setVerification(null);

    try {
      const verifyResponse = await fetch("/api/schedules/verify-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, url: url.trim() }),
      });
      const verifyData = await verifyResponse.json();

      if (!verifyResponse.ok) {
        throw new Error(verifyData?.message || "Failed to verify schedule source.");
      }

      setVerification({
        vendorId: verifyData.vendorId,
        confidence: verifyData.confidence,
        allowStatus: verifyData.allowStatus,
        evidenceSummary: verifyData.evidenceSummary,
        maskedUrl: verifyData.maskedUrl,
      });

      if (verifyData.allowStatus !== "active") {
        if (verifyData.allowStatus === "pending") {
          setError("This domain needs admin approval before previewing.");
        } else if (verifyData.allowStatus === "blocked") {
          setError("This domain is blocked for schedule imports.");
        } else {
          setError("We could not verify this schedule source.");
        }
        setPreview(null);
        setPreviewUrl(null);
        return;
      }

      const response = await fetch("/api/schedules/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, url: url.trim() }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to preview schedule.");
      }

      setPreview({
        vendor: data.vendor,
        title: data.title,
        eventsPreview: data.eventsPreview || [],
        maskedUrl: data.maskedUrl,
      });
      setTitle(data.title || "");
      setPreviewUrl(url.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preview schedule.");
    } finally {
      setPreviewLoading(false);
    }
  }, [orgId, url]);

  const handleConnect = useCallback(async () => {
    if (!preview || !previewUrl) {
      setError("Preview a schedule before importing.");
      return;
    }

    if (!isAdmin) {
      setError("Only admins can connect schedule sources.");
      return;
    }

    setConnectLoading(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/schedules/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, url: previewUrl, title: title.trim() || undefined }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to import schedule.");
      }

      setNotice("Schedule connected and syncing.");
      setPreview(null);
      setPreviewUrl(null);
      setTitle("");
      setUrl("");

      if (onConnect) {
        await onConnect();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import schedule.");
    } finally {
      setConnectLoading(false);
    }
  }, [isAdmin, onConnect, orgId, preview, previewUrl, title]);

  const previewEvents = useMemo(() => preview?.eventsPreview || [], [preview]);

  return {
    url,
    preview,
    previewUrl,
    verification,
    title,
    previewLoading,
    connectLoading,
    error,
    notice,
    previewDisabled,
    previewEvents,
    clearMessages,
    resetPreview,
    handleUrlChange,
    handleTitleChange,
    handlePreview,
    handleConnect,
  };
}
