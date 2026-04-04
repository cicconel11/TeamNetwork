---
date: 2026-04-04
topic: team-availability-time-axis
---

# Team Availability: Time-Axis Grid ("Find a Time" View)

## Problem Frame

The current Team Availability grid (`TeamAvailabilityRows`) shows one row per member with horizontal busy blocks inside each day cell. To answer "who is free at 3pm Tuesday?" a user must visually scan every row and mentally read the *absence* of blocks — the opposite of how availability should be communicated.

The redesign flips the axes to match Google Calendar's "Find a time" pattern: rows = hours, columns = days. Each cell directly answers "how many people are free right now?" with a count badge and color coding.

## Requirements

- **R1.** Replace the per-member row layout in `TeamAvailabilityRows` with a time-axis grid: rows are hours (6am–10pm), columns are the 7 days of the week.
- **R2.** Each hour cell displays a badge showing `N free` (count of members with no conflict that hour) and is color-coded:
  - Green — ≥75% of members free
  - Yellow/amber — 40–74% free
  - Red — <40% free
- **R3.** Clicking an hour cell expands an inline detail panel directly below the grid, showing:
  - A "Free" section: member avatars + names with a green checkmark
  - A "Busy" section: member avatars + names with a red X and the conflicting event title
  - The panel is dismissed by clicking the same cell again or clicking another cell (which shows that cell's detail instead)
- **R4.** Today's column retains the current-time visual indicator (red horizontal line across the row at the current hour).
- **R5.** The existing stats bar (Avg Availability %, Best Time, Members count) is preserved above the grid.
- **R6.** The existing best-window emerald accent moves to the column header (as it does today).
- **R7.** Week navigation (prev/next week, "This Week" shortcut) is preserved.
- **R8.** On mobile, the grid scrolls horizontally; hour labels in the left column remain sticky.

## Success Criteria

- A user can look at the grid and immediately see which days and hours have the most members free, without hovering or clicking.
- Clicking any cell shows exactly which players are free and which are busy at that hour.
- The grid is functionally equivalent to today in terms of data accuracy (uses the same `conflictGrid` data already computed).

## Scope Boundaries

- **Not in scope:** Keeping the old per-member row view as a toggle — the time-axis view fully replaces it.
- **Not in scope:** Sub-hour (30-minute) granularity in the new grid cells — hour-level is sufficient and matches `conflictGrid` resolution.
- **Not in scope:** Changes to `PersonalAvailabilityAgenda` (personal view is unchanged).
- **Not in scope:** Changes to `AvailabilityGrid` (the full-page hourly grid used in the calendar tab).

## Key Decisions

- **Time-axis grid over member rows:** Makes the "who is free now?" question answerable at a glance without interaction.
- **Inline panel over tooltip/drawer:** More accessible on mobile; tooltip is too fragile, drawer is too heavyweight for a quick reference.
- **Hour-level granularity:** The existing `conflictGrid` already computes availability per hour — no new data processing needed.

## Dependencies / Assumptions

- `conflictGrid: Map<"YYYY-MM-DD-H", BusyMember[]>` is already computed in `TeamAvailabilityRows` and contains exactly what R3 needs (member name, event title per hour).
- `totalMembers` is available in scope for computing free count per cell.
- The `members` array (with name + userId) is available for rendering the free member list in R3.

## Outstanding Questions

### Deferred to Planning

- [Affects R2][Technical] Exact Tailwind color tokens for green/amber/red cell backgrounds — should match the existing `AvailabilityGrid` heatmap palette (`emerald-500`, `amber-500`, `red-500`) for visual consistency.
- [Affects R1][Technical] Grid height: 16 rows × some row height — confirm minimum row height that keeps the grid scannable without excessive scroll.

## Next Steps

→ `/ce:plan` for structured implementation planning
