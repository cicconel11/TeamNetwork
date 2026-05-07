export type GoogleCalendarListItem = {
  id: string;
  summary: string;
  primary: boolean;
  backgroundColor?: string;
};

export type GoogleCalendarsApiBody = {
  calendars?: GoogleCalendarListItem[];
  connected?: boolean;
  error?: string;
};

export type GoogleCalendarConnectionState = {
  calendars: GoogleCalendarListItem[];
  reconnectRequired: boolean;
  disconnected: boolean;
};

export function resolveGoogleCalendarConnectionState(
  status: number,
  body: GoogleCalendarsApiBody,
): GoogleCalendarConnectionState {
  if (status === 403 && body.error === "reconnect_required") {
    return {
      calendars: [],
      reconnectRequired: true,
      disconnected: false,
    };
  }

  if (status >= 200 && status < 300 && body.connected === false) {
    return {
      calendars: [],
      reconnectRequired: false,
      disconnected: true,
    };
  }

  return {
    calendars: body.calendars || [],
    reconnectRequired: false,
    disconnected: false,
  };
}
