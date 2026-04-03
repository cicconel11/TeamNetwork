type UnifiedEventLinkTarget = {
  sourceType: "event" | "schedule" | "feed" | "class";
  id?: string;
  eventId?: string;
  academicScheduleId?: string;
  allDay?: boolean;
  startAt?: string;
};

const PLAIN_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parsePrefixedId(value: string | undefined, prefix: "event" | "class"): string | null {
  if (!value?.startsWith(`${prefix}:`)) {
    return null;
  }

  const remainder = value.slice(prefix.length + 1);
  if (!remainder) {
    return null;
  }

  if (prefix === "class") {
    return remainder.split(":")[0] || null;
  }

  return remainder;
}

export function getCalendarPrimaryActionHref(orgSlug: string): string {
  return `/${orgSlug}/calendar/new`;
}

export function getTeamEventCreationHref(orgSlug: string): string {
  return `/${orgSlug}/events/new`;
}

export function getUnifiedEventHref(
  orgSlug: string,
  event: UnifiedEventLinkTarget,
): string | null {
  if (
    event.sourceType === "event"
    && event.allDay
    && typeof event.startAt === "string"
    && PLAIN_DATE_PATTERN.test(event.startAt)
  ) {
    return null;
  }

  if (event.sourceType === "event") {
    const eventId = event.eventId ?? parsePrefixedId(event.id, "event");
    if (eventId) {
      return `/${orgSlug}/events/${eventId}`;
    }
  }

  if (event.sourceType === "class") {
    const scheduleId = event.academicScheduleId ?? parsePrefixedId(event.id, "class");
    if (scheduleId) {
      return `/${orgSlug}/calendar/${scheduleId}/edit`;
    }
  }

  return null;
}
