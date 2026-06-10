"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui";

interface EnrichmentStatusBadgeProps {
  orgId: string;
  alumniId: string;
  status: "pending" | "enriched" | "failed" | null;
  hasLinkedinUrl: boolean;
  canRetry: boolean;
}

/**
 * Small pill surfacing the LinkedIn enrichment state on the alumni detail
 * page. Copy is deliberately generic — the stored enrichment_error (raw
 * Apify output) is never rendered.
 */
export function EnrichmentStatusBadge({
  orgId,
  alumniId,
  status,
  hasLinkedinUrl,
  canRetry,
}: EnrichmentStatusBadgeProps) {
  const router = useRouter();
  const [isRetrying, setIsRetrying] = useState(false);

  if (!status) {
    return null;
  }

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      const response = await fetch(
        `/api/organizations/${orgId}/alumni/${alumniId}/enrichment-retry`,
        { method: "POST" }
      );
      if (!response.ok) {
        toast.error(
          response.status === 429
            ? "Too many retries — please wait a moment"
            : "Could not queue enrichment retry"
        );
        return;
      }
      toast.success("Enrichment queued");
      router.refresh();
    } catch {
      toast.error("Could not queue enrichment retry");
    } finally {
      setIsRetrying(false);
    }
  };

  if (status === "pending") {
    return (
      <Badge variant="muted" data-testid="enrichment-status-badge">
        Enriching from LinkedIn…
      </Badge>
    );
  }

  if (status === "enriched") {
    return (
      <Badge variant="success" data-testid="enrichment-status-badge">
        LinkedIn-enriched
      </Badge>
    );
  }

  // status === "failed"
  return (
    <span className="inline-flex items-center gap-2">
      <Badge variant="error" data-testid="enrichment-status-badge">
        LinkedIn enrichment failed
      </Badge>
      {canRetry && hasLinkedinUrl && (
        <button
          type="button"
          onClick={handleRetry}
          disabled={isRetrying}
          data-testid="enrichment-retry-button"
          className="text-xs font-medium text-[var(--color-org-primary)] hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRetrying ? "Queueing…" : "Retry"}
        </button>
      )}
    </span>
  );
}
