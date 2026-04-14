---
date: 2026-04-13
topic: mentorship-pm-upgrade
---

# Mentorship PM Upgrade

## Problem Frame

The current mentorship feature is passive — it records logs and pairs mentor/mentee but gives mentors no tools to actively guide a mentee's progress. Mentors want to act more like a product manager: assigning concrete tasks with deadlines, scheduling meetings, and tracking completion. The feature should feel like a lightweight Linear/Notion — focused, scannable, and action-oriented.

## Requirements

- R1. The mentorship page is restructured into a **tabbed layout**: Overview | Tasks | Meetings | Directory. The active tab is encoded in the URL (`?tab=tasks`) for deep-linking and browser navigation.
- R2. **Overview tab** displays the existing context strip (pairs management + status actions) and the pairs list with session logs. No behavior change from current.
- R3. **Directory tab** displays the existing mentor directory. No behavior change from current.
- R4. A new **`mentorship_tasks`** table stores pair-scoped tasks with: title, description, status (`todo` | `in_progress` | `done`), due_date, and soft-delete.
- R5. **Only mentors** can create tasks for their mentee. Mentees can update the status of tasks assigned to them. Neither role can cross-modify.
- R6. The **Tasks tab** renders a Notion-style flat list: columns are Title, Status (badge), Due Date, and Actions. Overdue tasks (due_date < today, status ≠ done) are visually highlighted. Filterable by status.
- R7. A new **`mentorship_meetings`** table stores pair-scoped meetings with: title, scheduled_at, duration_minutes, platform (`google_meet` | `zoom`), meeting_link, calendar_event_id, and soft-delete.
- R8. **Only mentors** can schedule meetings. When a meeting is created, the app: (1) generates a Google Meet link or Zoom join URL, and (2) creates a Google Calendar event with that link, inviting both mentor and mentee as attendees.
- R9. If the mentor has no Google Calendar connected, the meeting is still saved and the join link still works — calendar invite creation is best-effort with a UI warning on partial failure.
- R10. The **Meetings tab** shows upcoming meetings (as cards with join link button) and past meetings (as a condensed log). Mentors can schedule new meetings from this tab.
- R11. For **admins**, the Tasks and Meetings tabs show a pair-picker dropdown at the top to select which pair's data to view. For users who are in exactly one pair, their pair is pre-selected automatically.

## Success Criteria

- A mentor can create a task for their mentee in under 10 seconds with a title and due date.
- A mentee can mark a task done with a single click, with an optimistic update.
- A mentor can schedule a Google Meet or Zoom meeting, and both they and their mentee receive a Google Calendar invite with the video link.
- An admin can navigate to any pair's tasks or meetings without leaving the mentorship page.
- The current Overview and Directory functionality is unaffected.

## Scope Boundaries

- No drag-and-drop kanban — tasks are a flat list only.
- No task templates or org-level task pools — tasks are always pair-scoped and mentor-created.
- No Zoom OAuth per-user flow — Zoom uses server-to-server credentials (account-level), requires `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` env vars.
- No recurring meetings — each meeting is a one-off.
- No in-app video — links only (Google Meet URL or Zoom join_url).
- No notifications/emails when tasks are created or deadlines approach (can be added later).
- Mentorship meeting events do NOT appear in the main org calendar/events feature.

## Key Decisions

- **Tab state via URL query param**: `?tab=overview|tasks|meetings|directory`. Deep-linkable, refresh-safe, consistent with existing `useSearchParams` patterns in the codebase.
- **New `src/lib/google/mentorship-calendar.ts`** instead of modifying `calendar-sync.ts`: the existing calendar sync is a complex org-wide fan-out system. Meeting invites are point-to-point (mentor → mentee) and need `attendees` + `conferenceData` which the existing wrapper doesn't support. A new focused function avoids breaking the existing sync.
- **Tasks enforced at API route layer**: Mentee status-only restriction cannot be purely enforced by RLS. API route validates caller role and rejects non-status fields for mentees.
- **Meetings always go through API route**: Zoom API calls and Google Calendar invite creation require server-side credentials.

## Dependencies / Assumptions

- Google Calendar integration already exists (`src/lib/google/calendar-sync.ts`, `oauth.ts`). Mentors must have their Google account connected to receive a calendar invite; non-connected mentors get a soft warning.
- Zoom requires three new env vars: `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`.
- Migration timestamps must not collide with existing files in `supabase/migrations/` (latest is `20261012150000`).

## Outstanding Questions

### Deferred to Planning

- [Affects R8][Needs research] Confirm the exact Zoom server-to-server OAuth2 endpoint and `users/me/meetings` payload shape — verify against current Zoom API docs during implementation.
- [Affects R8][Technical] Determine whether `getValidAccessToken` in `src/lib/google/oauth.ts` returns null vs. throws when no Google connection exists — affects error handling in the meetings API route.
- [Affects R1][Technical] Confirm Next.js App Router `searchParams` typing for `page.tsx` — needs `Promise<{ tab?: string }>` in the latest Next.js 14 App Router version used by this project.

## Next Steps

→ `/ce:plan` for structured implementation planning
