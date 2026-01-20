# Mobile Naming Consistency Checklist

This document tracks naming consistency between mobile and web platforms. Each item must be audited, standardized, and signed off before implementation.

## Checklist

| Item | Current State | Target | Owner | Sign-off |
|------|---------------|--------|-------|----------|
| RSVP Labels | Mobile: "Going"/"Maybe"/"Not Going"<br>Web: "Attending"/"Maybe"/"Not Attending"<br>DB: "attending"/"maybe"/"not_attending" | **Standardize to:**<br>Display: "Going"/"Maybe"/"Not Going"<br>DB: "attending"/"maybe"/"not_attending"<br>**Action:** Update web to use "Going" instead of "Attending" | [ ] | [ ] |
| Role Labels | "Active Member", "Admin", "Alumni" | Confirm consistent across platforms<br>**Target:** "Active Member", "Admin", "Alumni" | [ ] | [ ] |
| Organization naming | "Organization" vs "Org" in UI | **Standardize:**<br>- Headers/titles: "Organization"<br>- Space-constrained: "Org"<br>- Consistent usage per context | [ ] | [ ] |
| Date formats | Various formats:<br>Mobile: `toLocaleDateString([], {...})`<br>Web: Various | **Standardize:**<br>Short: "Mon, Jan 20"<br>Full: "Monday, January 20, 2026"<br>**Action:** Create shared date formatter | [ ] | [ ] |
| Time formats | Various formats:<br>Mobile: `toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })` | **Standardize:**<br>"3:00 PM" (12hr with AM/PM, no leading zero)<br>**Action:** Create shared time formatter | [ ] | [ ] |
| Event status labels | TBD | **Standardize:**<br>"Cancelled", "Postponed", "Active"<br>**Action:** Define in types and use consistently | [ ] | [ ] |
| Empty states | Different copy per screen:<br>- "No upcoming events"<br>- "No Announcements"<br>- "No members found" | **Standardize patterns:**<br>- Title: "No [items]"<br>- Subtitle: Context-specific helpful message<br>**Action:** Audit all empty states and unify | [ ] | [ ] |
| Error messages | Ad-hoc per screen | **Create guidelines:**<br>- User-friendly language<br>- Actionable when possible<br>- Consistent tone<br>**Action:** Create error message component/utility | [ ] | [ ] |

---

## Detailed Findings

### RSVP Labels

**Current State:**
- **Database:** `"attending" | "maybe" | "not_attending"` (from `packages/types/src/database.ts`)
- **Web:** Displays "Attending", "Maybe", "Not Attending" (from `apps/web/src/components/events/EventRsvp.tsx`)
- **Mobile:** Displays "Going", "Maybe", "Not Going" (from `apps/mobile/app/(app)/[orgSlug]/(tabs)/events.tsx`)
- **Mobile Hook:** Incorrectly types as `"going" | "maybe" | "not_going"` (from `apps/mobile/src/hooks/useEvents.ts`)

**Issue:** 
- Mobile hook type doesn't match database schema
- Display labels differ between platforms

**Target:**
- **Display labels:** "Going", "Maybe", "Not Going" (consistent across platforms)
- **Database values:** Keep as `"attending" | "maybe" | "not_attending"`
- **Action:** 
  1. Fix mobile hook to use correct database types
  2. Update web to display "Going" instead of "Attending"
  3. Map database values to display labels consistently

### Role Labels

**Current State:**
- Web uses: "Active Member", "Admin", "Alumni" (from `apps/web/src/app/[orgSlug]/settings/invites/page.tsx`)
- Mobile uses: "Admin", "Member" (from `apps/mobile/app/(app)/[orgSlug]/(tabs)/members.tsx`)

**Target:**
- Standardize to: "Active Member", "Admin", "Alumni"
- **Action:** Update mobile to use "Active Member" instead of "Member"

### Date Formats

**Current State:**
- Mobile: `toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })` → "Monday, January 20"
- Mobile: `toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })` → "Jan 20, 2026"
- Web: Various formats

**Target:**
- Short format: "Mon, Jan 20"
- Full format: "Monday, January 20, 2026"
- **Action:** Create shared date formatter utility

### Time Formats

**Current State:**
- Mobile: `toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })` → "3:00 PM" (varies by locale)

**Target:**
- "3:00 PM" (12hr with AM/PM, no leading zero)
- **Action:** Create shared time formatter utility

### Empty States

**Current Examples:**
- Events: "No upcoming events" / "Check back later for new events"
- Announcements: "No Announcements" / "Check back later for news and updates."
- Members: "No members found" / "Try a different search" or "Members will appear here"

**Target Pattern:**
- Title: "No [items]" (consistent capitalization)
- Subtitle: Context-specific helpful message
- **Action:** Audit all empty states and create reusable component

### Error Messages

**Current State:**
- Ad-hoc messages per screen
- Some use generic "Error: {message}"

**Target:**
- User-friendly language
- Actionable when possible
- Consistent tone
- **Action:** Create error message guidelines and reusable component

---

## Implementation Notes

1. **RSVP Mapping:** Create a utility function to map database values to display labels:
   ```typescript
   export function getRsvpLabel(status: RsvpStatus): string {
     const labels = {
       attending: "Going",
       maybe: "Maybe",
       not_attending: "Not Going",
     };
     return labels[status];
   }
   ```

2. **Date/Time Formatters:** Create shared utilities in `packages/core/src/` or `apps/mobile/src/lib/`:
   - `formatDateShort(date: Date): string`
   - `formatDateFull(date: Date): string`
   - `formatTime(date: Date): string`

3. **Empty State Component:** Create reusable component with consistent styling and copy patterns.

4. **Error Message Component:** Create reusable error display component with consistent styling.

---

## Sign-off Process

1. **Audit:** Review current state across all platforms
2. **Standardize:** Define target naming/labels
3. **Implement:** Update code to match targets
4. **Verify:** Test across platforms
5. **Sign-off:** Mark checkbox when complete
