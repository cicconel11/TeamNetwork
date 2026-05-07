// Pure mapping utilities for Microsoft Graph calendar events — no Graph API dependency.

export interface MicrosoftCalendarEvent {
    subject: string;
    body?: { contentType: "text"; content: string };
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
    location?: { displayName: string };
}

/**
 * Maps an organization event to a Microsoft Graph calendar event format.
 *
 * Pure function: depends only on its arguments — safe to import in any context.
 *
 * Field mapping vs Google:
 * - summary  → subject
 * - description → body.content (nested, contentType: "text")
 * - location → location.displayName (nested)
 * - timeZone: IANA timezone name (Graph accepts IANA as-is)
 */
export function mapEventToMicrosoftCalendarEvent(event: {
    title: string;
    description?: string | null;
    location?: string | null;
    start_date: string;
    end_date?: string | null;
}, orgTimeZone?: string): MicrosoftCalendarEvent {
    const startDate = new Date(event.start_date);

    let endDate: Date;
    if (event.end_date) {
        endDate = new Date(event.end_date);
    } else {
        endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // +1 hour default
    }

    const timeZone = orgTimeZone || "UTC";

    const result: MicrosoftCalendarEvent = {
        subject: event.title,
        start: {
            dateTime: startDate.toISOString(),
            timeZone,
        },
        end: {
            dateTime: endDate.toISOString(),
            timeZone,
        },
    };

    if (event.description) {
        result.body = {
            contentType: "text",
            content: event.description,
        };
    }

    if (event.location) {
        result.location = {
            displayName: event.location,
        };
    }

    return result;
}
