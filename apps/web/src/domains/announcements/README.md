# Announcements domain

Org announcements: creating, editing, soft-deleting, and audience-scoped visibility.

## Owns

- **components/** — `AnnouncementCard`, `AnnouncementsFeed`, icons (UI).
- **server/** — `create-announcement`, `update-announcement` (mutations + admin
  permission checks + notification fan-out) and `visibility` (audience filtering,
  mirrors the `can_view_announcement` SQL predicate).

## Public API

Import from the barrel: `import { AnnouncementsFeed, createAnnouncement } from "@/domains/announcements"`.
Do not deep-import `server/` or `components/` from outside this domain.

## Not owned (shared infra, lives elsewhere)

- **Validation schemas** — still in `@/lib/schemas/content` (`createAnnouncementSchema`,
  `editAnnouncementSchema`, etc.). They share sub-schemas with the events domain,
  so splitting the `lib/schemas` barrel per-domain is a tracked follow-up.
- **AI assistant tools** — the `prepare-announcement` / `list-announcements` tool
  definitions live in the central AI registry (`@/lib/ai/tools/registry`); they
  consume this domain's mutations via the barrel.
- **Routes** — pages stay under `src/app/[orgSlug]/announcements/` (App Router
  requirement); they import from this domain.
