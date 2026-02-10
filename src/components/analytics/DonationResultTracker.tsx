"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { trackBehavioralEvent } from "@/lib/analytics/events";

interface DonationResultTrackerProps {
  organizationId: string;
}

export function DonationResultTracker({ organizationId }: DonationResultTrackerProps) {
  const params = useSearchParams();
  const didTrackRef = useRef(false);

  useEffect(() => {
    if (didTrackRef.current) return;

    const status = params.get("donation");
    if (!status) return;

    if (status === "success") {
      trackBehavioralEvent("donation_checkout_result", {
        result: "success",
      }, organizationId);
    }

    if (status === "cancelled" || status === "cancel") {
      trackBehavioralEvent("donation_checkout_result", {
        result: "cancel",
      }, organizationId);
    }

    didTrackRef.current = true;
  }, [organizationId, params]);

  return null;
}
