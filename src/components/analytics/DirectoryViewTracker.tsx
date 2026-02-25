"use client";

import { useEffect, useRef } from "react";
import { trackBehavioralEvent } from "@/lib/analytics/events";

interface DirectoryViewTrackerProps {
  organizationId: string;
  directoryType: "active_members" | "alumni" | "parents";
}

export function DirectoryViewTracker({ organizationId, directoryType }: DirectoryViewTrackerProps) {
  const didTrackRef = useRef(false);

  useEffect(() => {
    if (didTrackRef.current) return;
    didTrackRef.current = true;
    trackBehavioralEvent("directory_view", { directory_type: directoryType }, organizationId);
  }, [directoryType, organizationId]);

  return null;
}
