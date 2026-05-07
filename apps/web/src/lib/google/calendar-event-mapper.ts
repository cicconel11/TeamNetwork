// Pure mapping utilities for calendar events — no googleapis dependency.
// Extracted so tests can import without needing Google OAuth env vars.

export interface CalendarEvent {
    summary: string;
    description?: string;
    location?: string;
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
}

/**
 * Maps an organization event to a Google Calendar event format.
 *
 * Pure function: depends only on its arguments — safe to import in any context.
 *
 * For any organization event being synced, the resulting Google Calendar event SHALL contain:
 * - summary equal to event.title
 * - description equal to event.description (if present)
 * - location equal to event.location (if present)
 * - start.dateTime equal to event.start_date
 * - end.dateTime equal to event.end_date (or start_date + 1 hour if no end_date)
 */
export function mapEventToCalendarEvent(event: {
    title: string;
    description?: string | null;
    location?: string | null;
    start_date: string;
    end_date?: string | null;
}, orgTimeZone?: string): CalendarEvent {
    const startDate = new Date(event.start_date);

    // If no end_date, default to start_date + 1 hour
    let endDate: Date;
    if (event.end_date) {
        endDate = new Date(event.end_date);
    } else {
        endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // +1 hour
    }

    // Use org timezone so Google Calendar displays events at the correct local time
    const timeZone = orgTimeZone || "UTC";

    return {
        summary: event.title,
        description: event.description ?? undefined,
        location: event.location ?? undefined,
        start: {
            dateTime: startDate.toISOString(),
            timeZone,
        },
        end: {
            dateTime: endDate.toISOString(),
            timeZone,
        },
    };
}
