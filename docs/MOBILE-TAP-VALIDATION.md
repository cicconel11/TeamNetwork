# Mobile Tap-Count QA Checklist

Device: ____________  Date: ____________  Tester: ____________

| # | Workflow | Expected | Actual | Pass? |
|---|----------|----------|--------|-------|
| 1 | View upcoming event | 1 tap | 1 tap | [x] |
| 2 | RSVP Going to event | 2 taps | 2 taps | [x] |
| 3 | Change RSVP to Not Going | 2 taps | 2 taps | [x] |
| 4 | View latest announcement | 1 tap | 1 tap | [x] |
| 5 | Find member "John Smith" | 2 taps (Members + search) | 2 taps | [x] |
| 6 | Call member from profile | 3 taps | 3 taps | [x] |
| 7 | Switch to different org | 2 taps | 2 taps | [x] |
| 8 | Check in attendee (Admin) | 2 taps | 3 taps | [ ] |
| 9 | (Admin) View RSVP list | 2 taps | 2 taps | [x] |
| 10 | (Admin) Close RSVPs | 3 taps | N/A | [ ] |
| 11 | (Admin) Pin announcement | 3 taps | 3 taps | [x] |

**Pass criteria:** All workflows ≤ target taps

**Last validated:** 2026-01-23 (Code review validation)

---

## Validation Notes

### Passing Workflows (9/11)

1. **View upcoming event (1 tap)** ✅
   - Events tab → Tap event card → Event detail
   - File: `events.tsx:148` - `onPress={() => router.push(...)}`

2. **RSVP Going to event (2 taps)** ✅
   - Tap 1: Event card → Event detail
   - Tap 2: RSVP button on event detail

3. **Change RSVP to Not Going (2 taps)** ✅
   - Tap 1: Event card → Event detail
   - Tap 2: RSVP button (shows options)

4. **View latest announcement (1 tap)** ✅
   - Announcements tab → Tap announcement card
   - File: `announcements.tsx:142` - AnnouncementCard with onPress

5. **Find member "John Smith" (2 taps)** ✅
   - Tap 1: Members tab
   - Tap 2: Search bar (focus and type)
   - File: `members.tsx` - DirectorySearchBar in ListHeaderComponent

6. **Call member from profile (3 taps)** ✅
   - Tap 1: Members tab
   - Tap 2: Member card → Profile
   - Tap 3: Phone action on profile

7. **Switch to different org (2 taps)** ✅
   - Tap 1: Org logo in header → Opens drawer
   - Tap 2: Tap org in drawer list

9. **(Admin) View RSVP list (2 taps)** ✅
   - Tap 1: Event card → Event detail
   - Tap 2: Tap RSVP summary card (direct navigation)
   - File: `events/[eventId]/index.tsx:255` - Tappable rsvpSummary card

11. **(Admin) Pin announcement (3 taps)** ✅
    - Tap 1: Announcement card → Detail
    - Tap 2: Overflow menu (3-dot icon)
    - Tap 3: "Pin" menu item
    - File: `announcements/[announcementId]/index.tsx:199-242`

### Workflows Requiring Attention (2/11)

8. **Check in attendee (Admin) - Expected 2, Actual 3** ⚠️
   - Current flow:
     - Tap 1: Event card → Event detail
     - Tap 2: "Check In Attendees" button → Check-in screen
     - Tap 3: Tap attendee check-in button
   - **Recommendation:** Consider adding quick check-in from event detail for single attendees, or accept 3 taps as reasonable for admin workflow

10. **(Admin) Close RSVPs - NOT IMPLEMENTED** ❌
    - This action is not currently in the event admin overflow menu
    - Menu has: Edit Event, View RSVPs, Open in Web, Cancel Event
    - **Recommendation:** Add "Close RSVPs" to event detail overflow menu
    - File to update: `events/[eventId]/index.tsx:133-163`

---

## Validation Method

Run this checklist on a test device before each release. Document any deviations and update expected tap counts if workflows change.

### How to Validate

1. **Code Review Validation** (current method)
   - Trace user flows through source files
   - Count navigation steps and button presses

2. **Device Testing** (recommended for releases)
   - Use fresh test account
   - Record actual taps with screen recording
   - Note any loading states that add friction
