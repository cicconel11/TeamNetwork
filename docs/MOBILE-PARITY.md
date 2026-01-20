# Mobile Feature Parity Matrix

> **Mobile is consumption-first with quick actions; web remains the place for creation and complex editing.**

This document defines what features are available on mobile vs web, including permissions and visibility rules.

## Core Structure: 4 Content Areas + More Utility Tab

| Area | Type | Description |
|------|------|-------------|
| Home | Content | Dashboard overview |
| Events | Content | Events list, detail, RSVP |
| Announcements | Content | Announcements list, detail |
| Members | Content | Member directory |
| More | Utility | Org switcher, Profile, Settings, Sign out |

---

## Feature Parity Matrix with Permissions

| Feature | Mobile Level | Admin Quick Actions | Non-Admin Visibility | Web-Only |
|---------|--------------|---------------------|----------------------|----------|
| **Home** | Full | - | Same as admin | Full analytics, custom widgets |
| **Events** | Limited | See detailed list below | Actions hidden | Create, Edit details, Exports, Reporting |
| **Announcements** | Limited | Publish/Unpublish, Pin/Unpin | Actions hidden | Create, Edit content |
| **Members** | Read-only + contact | - | Same as admin | Bulk actions, Invites, Role changes |
| **Profile** | Limited | - | Same as admin | Full settings, Role management |
| **Notifications** | Full | - | Same as admin | Notification templates |
| **Alumni** | Hidden | - | Hidden | Full management |
| **Mentorship** | Hidden | - | Hidden | Full management |
| **Chat** | Hidden | - | Hidden | Full messaging |
| **Donations** | Hidden | - | Hidden | Full management |
| **Expenses** | Hidden | - | Hidden | Full management |
| **Schedules** | Hidden | - | Hidden | Full management |
| **Forms** | Hidden | - | Hidden | Full management |
| **Workouts** | Hidden | - | Hidden | Full management |
| **Competition** | Hidden | - | Hidden | Full management |
| **Philanthropy** | Hidden | - | Hidden | Full management |
| **Records** | Hidden | - | Hidden | Full management |

### Legend
- **Full**: Complete functionality available
- **Limited**: View + specific quick actions (admin only)
- **Read-only + contact**: View only, but includes contact actions (call/email/message)
- **Hidden**: Not accessible on mobile
- **Actions hidden**: Non-admins don't see admin action buttons (not disabled, just not rendered)

---

## Events Admin Quick Actions (Detailed)

| Action | Who Can Do It | Non-Admin View | Description |
|--------|---------------|----------------|-------------|
| View RSVP list | Admin | Hidden | See list of RSVPs with status |
| Mark attended | Admin | Hidden | Check off attendees at event |
| Remove RSVP | Admin | Hidden | Remove a specific RSVP |
| Open RSVPs | Admin | Hidden | Enable RSVP for event |
| Close RSVPs | Admin | Hidden | Disable RSVP (cap reached or cutoff) |
| Publish event | Admin | Hidden | Make draft event visible |
| Unpublish event | Admin | Hidden | Hide event from members |
| Update status | Admin | Hidden | Set to Cancelled/Postponed/Active |

**Explicitly NOT on mobile (Events):**
- Create new event
- Edit event title
- Edit event time/date
- Edit event location
- Edit event description
- Export attendance list
- View attendance analytics
- Set RSVP limits/caps (web-only setting)

---

## Announcements Admin Quick Actions (Detailed)

| Action | Who Can Do It | Non-Admin View | Description |
|--------|---------------|----------------|-------------|
| Publish | Admin | Hidden | Make draft announcement visible |
| Unpublish | Admin | Hidden | Hide announcement from members |
| Pin | Admin | Hidden | Pin to top of list and Home |
| Unpin | Admin | Hidden | Remove from pinned position |

**Explicitly NOT on mobile (Announcements):**
- Create new announcement
- Edit announcement title
- Edit announcement body/content

---

## Feature Scope Details

### Events (Limited - View + RSVP + Check-in + Admin Quick Actions)

**All Users:**
- View upcoming/past events list
- View event details (title, description, location, time)
- RSVP: Going / Maybe / Not Going
- Check-in at events (QR or proximity)
- Push notifications for reminders

**Admin Quick Actions:**
- View RSVP list (attendee names + status)
- Mark attended (check off attendees)
- Remove RSVP (remove a specific person's RSVP)
- Open/Close RSVPs (enable/disable RSVP button)
- Publish/Unpublish event (visibility toggle)
- Update event status (Cancelled / Postponed / Active)

### Announcements (Limited - Read + Notifications + Admin Quick Actions)

**All Users:**
- View announcements list
- View announcement detail
- Pinned announcement on Home
- Push notifications for new announcements

**Admin Quick Actions:**
- Publish/Unpublish announcement
- Pin/Unpin announcement

### Members (Read-only + Contact Actions)

**All Users:**
- Browse member directory
- Search by name
- View member profile (name, role, contact info)
- Contact actions:
  - Call (opens phone dialer)
  - Email (opens mail app)
  - Message (opens SMS/iMessage)

**Explicitly NOT on Mobile:**
- Add/invite new members
- Bulk actions (select multiple, bulk email)
- Edit member details
- Role management
- Remove members

### Profile & More (Limited - Self-Management)

**All Users:**
- View own profile
- Edit own profile (name, photo, contact info)
- Notification preferences
- Switch organization
- Sign out
- View org info

**Explicitly NOT on Mobile:**
- Full organization settings
- Billing management
- Navigation customization
- Role/permission management

---

## Non-Goals

The following are explicitly **out of scope** for mobile:

1. **Event/announcement creation** - Use web to create new events and announcements
2. **Content editing** - Editing event title/time/location, announcement body
3. **Exports and reporting** - Attendance exports, analytics, CSV downloads
4. **Bulk member actions** - Select multiple members, bulk email, bulk role changes
5. **Role management** - Changing user roles, permissions, access levels
6. **Organization settings** - Billing, navigation customization, integrations
7. **Hidden feature modules** - Alumni, Mentorship, Chat, Donations, Expenses, Schedules, Forms, Workouts, Competition, Philanthropy, Records
