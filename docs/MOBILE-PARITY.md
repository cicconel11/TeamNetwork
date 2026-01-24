# Mobile Feature Parity Matrix

> **Last Updated:** 2026-01-24

This document defines what features are available on mobile vs web, including permissions and visibility rules.

## Navigation Structure

### Tab Bar (6 tabs)
| Tab | Screen | Description |
|-----|--------|-------------|
| Home | Dashboard | Activity feed, stats, pinned content |
| Events | Events list | Upcoming/past events with RSVP |
| Announcements | Announcements list | Org-wide communications |
| Members | Member directory | Active member profiles |
| Alumni | Alumni directory | Alumni profiles (if enabled) |
| Menu | Quick actions | Overflow for less common actions |

### Drawer Navigation (Grouped Sections)
| Section | Items |
|---------|-------|
| Main (no header) | Home, Chat, Alumni*, Mentorship |
| Training | Workouts, Competition, Schedules, Records |
| Money | Philanthropy, Donations, Expenses |
| Other | Forms |
| Pinned Footer | Settings, Navigation, Organizations, Sign Out |

*Alumni visible based on `permissions.canViewAlumni`

---

## Feature Parity Matrix

| Feature | Mobile Status | Admin Actions | Web-Only |
|---------|---------------|---------------|----------|
| **Home** | Full | - | Custom widgets, analytics dashboard |
| **Events** | Full | Edit, RSVP mgmt, Check-in | Exports, reporting |
| **Announcements** | Full | Create, Edit, Publish, Pin | Templates |
| **Members** | Full + Contact | Invite, Edit role | Bulk actions, CSV export |
| **Alumni** | Full | - | Bulk import |
| **Chat** | Full | - | - |
| **Mentorship** | View | - | Matching, assignments |
| **Workouts** | Full | Create, Edit | Templates |
| **Competition** | Full | Add teams, Add points | Historical data |
| **Schedules** | Full | Create, Edit | Recurring patterns |
| **Records** | View | - | Create, Edit |
| **Philanthropy** | Full | Create events | Reporting |
| **Donations** | Full | Record donation | Stripe dashboard |
| **Expenses** | Full | Submit, Approve | Reporting, exports |
| **Forms** | View + Submit | - | Create, Edit |
| **Settings** | Limited | Nav config | Full org settings, billing |

### Legend
- **Full**: View + Create/Edit capabilities
- **Limited**: View + specific actions only
- **View**: Read-only access
- **View + Contact**: Read-only with call/email/message actions

---

## Events (Full)

**All Users:**
- View upcoming/past events list
- View event details (title, description, location, time)
- RSVP: Going / Maybe / Not Going
- Check-in at events (QR or proximity)
- Push notifications for reminders

**Admin Actions:**
- Create new event
- Edit event details
- View RSVP list with status
- Mark attendees as checked in
- Open/Close RSVPs
- Publish/Unpublish event
- Update status (Cancelled/Postponed/Active)

**Web-Only:**
- Export attendance list (CSV)
- View attendance analytics
- Set RSVP limits/caps
- Recurring event patterns

---

## Announcements (Full)

**All Users:**
- View announcements list
- View announcement detail
- Push notifications for new announcements

**Admin Actions:**
- Create new announcement
- Edit announcement content
- Publish/Unpublish
- Pin/Unpin

**Web-Only:**
- Announcement templates
- Scheduled publishing

---

## Members (Full + Contact)

**All Users:**
- Browse member directory
- Search by name
- View member profile (name, role, contact info)
- Contact actions: Call, Email, Message
- Filter by class year, role

**Admin Actions:**
- Create invite links
- Edit member roles
- Remove members

**Web-Only:**
- Bulk invite
- CSV export
- Bulk role changes

---

## Screen File Locations

```
apps/mobile/app/(app)/(drawer)/[orgSlug]/
├── (tabs)/                    # Tab bar screens
│   ├── index.tsx              # Home
│   ├── events.tsx             # Events list
│   ├── announcements.tsx      # Announcements list
│   ├── members.tsx            # Members directory
│   ├── alumni.tsx             # Alumni directory
│   └── menu.tsx               # Quick actions menu
├── chat/
│   ├── index.tsx              # Chat groups list
│   └── [groupId].tsx          # Chat room
├── events/
│   ├── [eventId]/index.tsx    # Event detail
│   ├── [eventId]/edit.tsx     # Edit event
│   ├── [eventId]/rsvps.tsx    # RSVP management
│   ├── check-in.tsx           # Event check-in
│   └── new.tsx                # Create event
├── announcements/
│   ├── [announcementId]/index.tsx  # Detail
│   ├── [announcementId]/edit.tsx   # Edit
│   └── new.tsx                     # Create
├── workouts/
│   ├── index.tsx              # Workouts list
│   ├── [workoutId]/edit.tsx   # Edit workout
│   └── new.tsx                # Create workout
├── competition/
│   ├── index.tsx              # Competition standings
│   ├── add-team.tsx           # Add team
│   └── add-points.tsx         # Add points
├── schedules/
│   ├── index.tsx              # Schedules list
│   ├── [scheduleId]/edit.tsx  # Edit schedule
│   └── new.tsx                # Create schedule
├── records/
│   └── index.tsx              # Records list
├── philanthropy/
│   ├── index.tsx              # Philanthropy events
│   └── new.tsx                # Create event
├── donations/
│   ├── index.tsx              # Donations list
│   └── new.tsx                # Record donation
├── expenses/
│   ├── index.tsx              # Expenses list
│   └── new.tsx                # Submit expense
├── forms/
│   ├── index.tsx              # Forms list
│   ├── [formId].tsx           # Form detail/submit
│   └── documents/[documentId].tsx  # Document viewer
├── mentorship.tsx             # Mentorship overview
├── settings.tsx               # Org settings
└── settings/navigation.tsx    # Navigation config
```

---

## Related Documentation

- `CLAUDE.md` - Mobile design tokens, screen patterns, drawer navigation
- `docs/MOBILE-TAP-VALIDATION.md` - Touch target requirements
