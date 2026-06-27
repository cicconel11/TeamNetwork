/**
 * Events domain — public API.
 *
 * Import event functionality from `@/domains/events` rather than reaching into
 * `server/` or `components/` directly. See `./README.md`.
 */

// Server: mutations, queries, permissions, recurrence
export {
  createEvent,
  type CreateEventInput,
  type CreateEventResult,
  type CreateEventErrorCode,
  type CreateEventInternalError,
} from "./server/create-event";
export { updateEvent, type UpdateEventResult, type UpdateEventScope } from "./server/update-event";
export { deleteEvent, type DeleteEventResult } from "./server/delete-event";
export { requireEventAdmin, type EventPermissionResult } from "./server/permissions";
export {
  createRecurringEvents,
  updateFutureEvents,
  deleteEventsInSeries,
  type DeleteEventScope,
} from "./server/recurring-operations";
export {
  expandRecurrence,
  type RecurrenceRule,
  type OccurrenceType,
  type EventInstanceDate,
} from "./server/recurrence";
export { resolveEventLabel, resolveEventActionLabel } from "./server/labels";
export { EVENT_TYPE_OPTIONS } from "./server/event-type-options";

// UI components
export {
  EventRsvp,
  AttendanceList,
  EventDeleteButton,
  RecurringEventDeleteButton,
  GoogleCalendarBanner,
  OutlookCalendarBanner,
} from "./components";
