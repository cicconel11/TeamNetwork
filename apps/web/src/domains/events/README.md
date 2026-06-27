# Events domain

Calendar events: creation, updates, soft-delete, recurrence expansion, RSVP /
attendance UI, and admin permission checks.

## Owns

- **components/** — `EventRsvp`, `AttendanceList`, `EventDeleteButton`,
  `RecurringEventDeleteButton`, `GoogleCalendarBanner`, `OutlookCalendarBanner`.
- **server/** — `create-event`, `update-event`, `delete-event` (mutations),
  `permissions` (`requireEventAdmin`), `recurrence` + `recurring-operations`
  (series expansion & batch ops), `labels`, `event-type-options`.

## Public API

Import from the barrel: `import { createEvent, EventRsvp } from "@/domains/events"`.
Do not deep-import `server/` or `components/` from outside this domain.

## Not owned (shared infra, lives elsewhere — intentionally not moved)

- **Validation schemas** — event form schemas (`newEventSchema`, `editEventSchema`,
  recurrence schemas) stay in `@/lib/schemas/content`, and the AI draft schemas
  stay in `@/lib/schemas/events-ai`. Both are shared with the AI subsystem and
  (for content) the announcements domain, so splitting the `lib/schemas` barrel
  per-domain is a tracked follow-up. Moving only half the event schemas would
  scatter them, so neither moves yet.
- **Calendar sync / providers** — `@/lib/calendar/*`, `@/lib/google` and
  `@/lib/microsoft` calendar-event mappers are cross-cutting integrations.
- **Analytics / payments** — `@/lib/analytics/events*` (telemetry) and
  `@/lib/payments/stripe-events` (Stripe webhooks) are unrelated to calendar
  events despite the name.
- **AI assistant tools** — `prepare-event` / `list-events` tool definitions live
  in the central AI registry (`@/lib/ai/tools/registry`); they consume this
  domain's mutations via the barrel.
- **Routes & API** — pages under `src/app/[orgSlug]/{events,calendar}/` and
  `src/app/api/calendar/*`, `api/cron/event-reminders`, `api/wallet/event/*`,
  `api/schedules/events` stay in the App Router and import from this domain.
