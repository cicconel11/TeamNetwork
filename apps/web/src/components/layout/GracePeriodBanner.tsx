"use client";

import { useState } from "react";

interface GracePeriodBannerProps {
  daysRemaining: number;
  orgSlug: string;
  organizationId: string;
}

export function GracePeriodBanner({ daysRemaining, organizationId }: GracePeriodBannerProps) {
  const [isResubscribing, setIsResubscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResubscribe = async () => {
    setIsResubscribing(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/billing-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Unable to open billing portal");
      }
      window.location.href = data.url as string;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open billing portal");
      setIsResubscribing(false);
    }
  };

  return (
    <div className="bg-amber-500/90 text-amber-950 px-4 py-3 text-center text-sm font-medium">
      <div className="flex items-center justify-center gap-4 flex-wrap">
        <span>
          Your subscription ended. You have <strong>{daysRemaining} day{daysRemaining !== 1 ? "s" : ""}</strong> to resubscribe before this organization is deleted.
        </span>
        <button
          onClick={handleResubscribe}
          disabled={isResubscribing}
          className="bg-amber-950 text-amber-100 px-3 py-1 rounded-md text-xs font-semibold hover:bg-amber-900 transition-colors disabled:opacity-50"
        >
          {isResubscribing ? "Opening..." : "Resubscribe Now"}
        </button>
      </div>
      {error && (
        <p className="text-amber-950/80 text-xs mt-1">{error}</p>
      )}
    </div>
  );
}
