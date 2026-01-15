# TeamMeet Mobile Navigation UX Plan

## Overview

Bottom tab navigation inspired by Uber/Venmo for the TeamMeet mobile app.

## Tab Bar Structure

```
┌─────────────────────────────────────────┐
│  Home   Events   [+]   Members   Menu   │
└─────────────────────────────────────────┘
```

**Icons (Lucide, match web):**
- Home → `home`
- Events → `calendar`
- Action → `plus` (raised 56pt circle, primary color)
- Members → `users`
- Menu → `menu`

**Visual treatment:**
- Active: filled icon + label + accent color
- Inactive: outline icon, muted gray
- Center button: raised circle, white plus icon
- Safe area padding for home indicator

---

## Tab Content

### Home Tab
Dashboard showing what matters now.

1. **Welcome Header** - "Good morning, [Name]" + org name + date
2. **Quick Stats Row** - Role-aware metrics (members, RSVPs, donations)
3. **Upcoming Events Card** - Next 1-2 events with quick RSVP
4. **Pinned Announcement Card** - Latest pinned, 3-line preview
5. **Latest** - 2-3 activity items (new members, RSVPs, donations)

### Events Tab
Calendar and event management.

1. **Toggle** - Upcoming | Past
2. **7-Day Strip** - Horizontal scroll, dots for events, primary nav
3. **Month Picker** - Secondary, collapsible
4. **Events List** - Cards with title, time, location, RSVP count
   - Status: Going / Maybe / Not Going + RSVP CTA
5. **Empty state** - Role-aware ("Create your first event" for admin)

*No FAB - center (+) handles creation*

### Members Tab
People directory with swipeable sub-tabs.

**Sub-tabs:** Members | Alumni (swipeable)

1. **Search Bar** - Sticky, instant filter
2. **Filter Button** - Opens filter sheet
3. **People List** - Tight rows (name + 1 detail line)
   - Members: avatar, name, role badge (Admin/Member)
   - Alumni: +graduation year, company
4. **Alumni grouped by decade** - Sticky section headers
5. **Tap → Bottom Sheet** - Profile preview, expand for full

**Empty states:** Role-aware CTAs (admin: "Invite Members", member: "No members yet")

### Menu Tab
Org switcher, settings, feature access.

1. **Account Block**
   - Org logo + name + "Switch Organization" button
   - Your avatar + name + "Edit Profile" link

2. **Updates**
   - Notifications (with unread badge)

3. **Community**
   - Donations
   - Records
   - Forms

4. **Admin** (role-gated, hidden for members)
   - Settings
   - Invites
   - Billing

5. **App**
   - Help & Support
   - About TeamMeet
   - Sign Out

---

## Center Action Button

Tap opens bottom sheet (40% height) with role-aware quick actions.

**Admin Actions:**
| Action | Destination |
|--------|-------------|
| Create Event | New event form |
| Post Announcement | Compose screen |
| Invite Member | Invite flow |
| Record Donation | Donation entry |

**Member Actions:**
| Action | Destination |
|--------|-------------|
| RSVP to Event | Upcoming events picker |
| Check In | Active event check-in |
| Share Org | Share link/invite |

**Interaction:**
- Grid of action tiles (icon + label)
- Tap outside or swipe down to dismiss

---

## 5 UI Rules

### 1. Cards are the unit
- All content in white cards on `#F5F5F5` background
- 16pt padding, 12pt border radius
- 1pt subtle shadow or border (no heavy elevation)

### 2. Spacing is sacred
- 16pt between cards
- 8pt between elements within cards
- 24pt top margin under headers
- Never stack content edge-to-edge

### 3. Badges are minimal
- Unread counts: small red dot or number (max "9+")
- Role badges: subtle pill (gray bg, dark text)
- Status colors: green=going, yellow=maybe (not loud)

### 4. Search before scroll
- Every list screen has search at top
- Filters via icon button (not inline pills)
- Results filter instantly as user types

### 5. Empty states guide
- Illustration + short headline + single CTA
- CTAs are role-aware (admin vs member messaging)
- Never show broken/blank screens

---

## Files to Modify

**New/Major Changes:**
- `apps/mobile/app/(app)/[orgSlug]/_layout.tsx` - New 5-tab layout with raised center button
- `apps/mobile/app/(app)/[orgSlug]/(tabs)/index.tsx` - Redesigned Home dashboard
- `apps/mobile/app/(app)/[orgSlug]/(tabs)/events.tsx` - New Events tab
- `apps/mobile/app/(app)/[orgSlug]/(tabs)/members.tsx` - Members with sub-tabs
- `apps/mobile/app/(app)/[orgSlug]/(tabs)/menu.tsx` - New Menu tab

**New Components:**
- `apps/mobile/src/components/ActionSheet.tsx` - Center button bottom sheet
- `apps/mobile/src/components/TabBar.tsx` - Custom tab bar with raised center
- `apps/mobile/src/components/PeopleSubTabs.tsx` - Swipeable Members/Alumni

**Hooks to Add:**
- `useEvents` - Fetch events for org
- `useNotifications` - Fetch notification count

---

## Verification

1. **Visual:** Tab bar renders with 5 tabs, center button raised
2. **Navigation:** Each tab navigates correctly, sub-tabs swipe
3. **Role awareness:** Admin sees admin actions, members see member actions
4. **Empty states:** All screens show appropriate empty state
5. **Search:** Members/Alumni filter instantly on type
