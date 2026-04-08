---
date: 2026-04-06
topic: outlook-calendar-sync
---

# Outlook Calendar Sync

## Problem Frame

TeamMeet already supports Google Calendar sync — both personal sync (pushing org events to a member's personal Google Calendar) and team schedule source (admins importing an org calendar from Google). Members and organizations that use Microsoft 365 / Outlook have no equivalent. This feature adds full parity so Outlook users get the same experience as Google users.

## Requirements

### Personal Sync (User-facing)

- R1. Users can connect their Microsoft 365 / Outlook account via OAuth to receive org events in their personal Outlook calendar.
- R2. Users can select which Outlook calendar (within their account) to sync events into, defaulting to their primary calendar.
- R3. Users can configure per-event-type sync preferences (general, game, meeting, social, fundraiser, philanthropy, practice, workout) — mirroring Google's `calendar_sync_preferences`.
- R4. Events are pushed to Outlook when created, updated, or deleted in the org — matching Google's event-sync trigger pattern.
- R5. Users can manually trigger a sync from the settings UI.
- R6. Users can disconnect Outlook sync; disconnecting revokes tokens and removes all synced calendar entries.
- R7. A banner on the calendar page surfaces connection status and a CTA to connect (dismissible), mirroring `GoogleCalendarBanner`.
- R8. A settings panel (mirroring `GoogleCalendarSyncPanel`) shows connection status, account email, target calendar selector, and event-type toggles.

### Team Schedule Source (Admin-facing)

- R9. Org admins can add an Outlook / Exchange calendar as a read-only org schedule source, mirroring `TeamGoogleCalendarConnect`.
- R10. Admins must have an active personal Outlook connection to connect a team calendar (same gate as the Google flow).
- R11. Once connected, the team Outlook calendar syncs events into the org's feed on the same cadence as other schedule sources.

### Shared / Cross-cutting

- R12. Tokens are encrypted at rest using the same AES-256-GCM scheme as Google tokens.
- R13. Access tokens are refreshed automatically before expiry using the stored refresh token.
- R14. If a token cannot be refreshed, the connection is marked with a `reconnect_required` state and the user is prompted to re-authenticate.
- R15. Audience filtering (members-only, alumni, all) and org membership checks apply to Outlook sync exactly as they do for Google sync.

## Success Criteria

- A member using Microsoft 365 can connect Outlook, see org events appear in their personal Outlook calendar, and manage preferences — with no additional steps beyond what Google requires.
- An org admin can add an Outlook calendar as a team schedule source and see its events populate the org feed.
- Google Calendar sync is unaffected by this change.

## Scope Boundaries

- ICS/feed-based Outlook subscribe is already supported via `CalendarSyncPanel`; this feature is OAuth-based push sync only.
- No support for Exchange on-premises servers — Microsoft 365 / Graph API only.
- No mobile push notifications or native app integrations — web only.
- Outlook sync preferences are per-org, same granularity as Google (no finer controls in this scope).

## Key Decisions

- **Mirror, don't abstract**: Implement Outlook as a parallel set of files matching the Google structure (separate `src/lib/microsoft/`, `src/app/api/microsoft/`, etc.) rather than refactoring Google code into a generic provider abstraction. Rationale: avoids destabilizing the working Google integration; the user explicitly requested the same code pattern.
- **Shared DB tables with provider column vs. separate tables**: Deferred to planning — both approaches are viable; planning should evaluate schema impact.

## Dependencies / Assumptions

- An Azure AD app registration is required with `Calendars.ReadWrite`, `User.Read`, and `offline_access` scopes. Env vars `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` will be needed.
- The Microsoft Graph API (`@microsoft/microsoft-graph-client` or raw fetch) will be used — no existing Microsoft SDK in the repo.
- The existing `GOOGLE_TOKEN_ENCRYPTION_KEY` can be reused for Outlook tokens (same algorithm, same key).

## Outstanding Questions

### Resolve Before Planning

_(none — all product decisions are resolved)_

### Deferred to Planning

- [Affects R1–R8, R12][Technical] Shared `user_calendar_connections` table with `provider` enum vs. a new `user_outlook_connections` table — evaluate migration complexity and RLS impact.
- [Affects R9–R11][Technical] Shared `calendar_feeds` / `schedule_sources` tables with `provider: "outlook"` or separate — align with how Google team source is stored.
- [Affects R1][Needs research] Microsoft Graph OAuth scopes and token endpoint for delegated calendar access — confirm `offline_access` grants refresh tokens in all M365 tenants.
- [Affects R13][Needs research] Microsoft token expiry behavior — Graph access tokens expire in 1 hour (same as Google); confirm refresh grant behavior matches.

## Next Steps

→ `/ce:plan` for structured implementation planning
