"use client";

import { useEffect, useRef } from "react";
import { trackBehavioralEvent } from "@/lib/analytics/events";

interface EventsViewTrackerProps {
  organizationId: string;
  viewMode: "upcoming" | "past" | "calendar";
}

export function EventsViewTracker({ organizationId, viewMode }: EventsViewTrackerProps) {
  const didTrackRef = useRef(false);

  useEffect(() => {
    if (didTrackRef.current) return;
    didTrackRef.current = true;
    trackBehavioralEvent("events_view", { view_mode: viewMode }, organizationId);
  }, [organizationId, viewMode]);

  return null;
}

interface EventOpenTrackerProps {
  organizationId: string;
  eventId: string;
}

export function EventOpenTracker({ organizationId, eventId }: EventOpenTrackerProps) {
  const didTrackRef = useRef(false);

  useEffect(() => {
    if (didTrackRef.current) return;
    didTrackRef.current = true;
    trackBehavioralEvent("event_open", { event_id: eventId }, organizationId);
  }, [eventId, organizationId]);

  return null;
}
