type UnifiedEventLinkTarget = {
  sourceType: "event" | "schedule" | "feed" | "class";
  eventId?: string;
  academicScheduleId?: string;
};

export function getCalendarPrimaryActionHref(orgSlug: string): string {
  return `/${orgSlug}/events/new`;
}

export function getUnifiedEventHref(
  orgSlug: string,
  event: UnifiedEventLinkTarget,
): string | null {
  if (event.sourceType === "event" && event.eventId) {
    return `/${orgSlug}/events/${event.eventId}`;
  }

  if (event.sourceType === "class" && event.academicScheduleId) {
    return `/${orgSlug}/calendar/${event.academicScheduleId}/edit`;
  }

  return null;
}
