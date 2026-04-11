export type MicrosoftCalendarListItem = {
  id: string;
  name: string;
  isDefault: boolean;
  hexColor?: string;
};

export type MicrosoftCalendarsApiBody = {
  calendars?: MicrosoftCalendarListItem[];
  error?: string;
};

export type MicrosoftCalendarConnectionState = {
  calendars: MicrosoftCalendarListItem[];
  reconnectRequired: boolean;
  disconnected: boolean;
};

/**
 * Resolves the Outlook Calendar connection state from an API response.
 *
 * Branch map:
 *  - 403 + { error: "reconnect_required" }  → reconnectRequired: true
 *  - 2xx + calendars missing                → disconnected: true
 *  - 2xx + calendars present                → connected, returns calendars
 */
export function resolveMicrosoftCalendarState(
  status: number,
  body: MicrosoftCalendarsApiBody,
): MicrosoftCalendarConnectionState {
  if (status === 403 && body.error === "reconnect_required") {
    return { calendars: [], reconnectRequired: true, disconnected: false };
  }

  if (status >= 200 && status < 300 && body.calendars === undefined) {
    return { calendars: [], reconnectRequired: false, disconnected: true };
  }

  return {
    calendars: body.calendars ?? [],
    reconnectRequired: false,
    disconnected: false,
  };
}
