---
date: 2026-04-21
topic: album-global-search
---

# Add Albums to Global Search

## Problem Frame
Users with many albums have no fast way to find a specific one. The global search (Cmd+K) currently covers members, alumni, announcements, discussions, events, and jobs — but not albums. Users must scroll through the album grid manually.

## Requirements
- R1. Albums appear in global Cmd+K search results, matched on `name` and `description`
- R2. Clicking an album result navigates to the album detail view within the media gallery
- R3. Album results show an appropriate icon (e.g., `Image` or `FolderOpen`) and label "Album"
- R4. Short queries (<4 chars) use substring matching; longer queries use trigram similarity — matching existing search behavior

## Success Criteria
- Searching for an album name in Cmd+K returns the album in results
- Clicking the result opens the album detail view

## Scope Boundaries
- No album-specific search within the media gallery page (out of scope)
- No AI/semantic search changes needed — albums join fast mode only
- No changes to album CRUD or media upload flows

## Key Decisions
- **Global search only**: Simpler to implement, consistent UX, avoids duplicating search UI
- **Deep-link via query param**: MediaGallery reads `?album=<id>` to auto-open an album, since albums currently use client-side state only

## Next Steps
→ `/ce:plan` for structured implementation planning
