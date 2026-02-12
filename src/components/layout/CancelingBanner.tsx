"use client";

import { useState } from "react";
import { formatGracePeriodDate } from "@/lib/subscription/grace-period";

interface CancelingBannerProps {
  periodEndDate: string;
  orgSlug: string;
  organizationId: string;
  isAdmin?: boolean;
}

export function CancelingBanner({ periodEndDate, organizationId, isAdmin }: CancelingBannerProps) {
  const [isResuming, setIsResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResume = async () => {
    setIsResuming(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${organizationId}/resume-subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to resume subscription");
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to resume subscription");
      setIsResuming(false);
    }
  };

  return (
    <div className="bg-blue-500/90 text-white px-4 py-3 text-center text-sm font-medium">
      <div className="flex items-center justify-center gap-4 flex-wrap">
        <span>
          Your subscription will end on <strong>{formatGracePeriodDate(periodEndDate)}</strong>. Resume your subscription to keep full access.
        </span>
        {isAdmin ? (
          <button
            onClick={handleResume}
            disabled={isResuming}
            className="bg-white text-blue-700 px-3 py-1 rounded-md text-xs font-semibold hover:bg-blue-50 transition-colors disabled:opacity-50"
          >
            {isResuming ? "Resuming..." : "Resume Subscription"}
          </button>
        ) : (
          <span className="text-xs opacity-80">
            Ask your admin to resume the subscription.
          </span>
        )}
      </div>
      {error && (
        <p className="text-white/80 text-xs mt-1">{error}</p>
      )}
    </div>
  );
}
