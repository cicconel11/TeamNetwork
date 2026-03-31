import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("calendar/events consolidation source wiring", () => {
  it("legacy events routes redirect into canonical calendar routes", () => {
    const eventsIndex = readFileSync("src/app/[orgSlug]/events/page.tsx", "utf-8");
    const eventsNew = readFileSync("src/app/[orgSlug]/events/new/page.tsx", "utf-8");
    const eventsDetail = readFileSync("src/app/[orgSlug]/events/[eventId]/page.tsx", "utf-8");
    const eventsEdit = readFileSync("src/app/[orgSlug]/events/[eventId]/edit/page.tsx", "utf-8");

    assert.match(eventsIndex, /redirect\(calendarEventsPath/);
    assert.match(eventsNew, /redirect\(calendarNewEventPath/);
    assert.match(eventsDetail, /redirect\(calendarEventDetailPath/);
    assert.match(eventsEdit, /redirect\(calendarEventEditPath/);
  });

  it("calendar page uses an events-first toggle and add-event action", () => {
    const calendarPage = readFileSync("src/app/[orgSlug]/calendar/page.tsx", "utf-8");

    assert.match(calendarPage, /parseCalendarView/);
    assert.match(calendarPage, /CalendarViewToggle/);
    assert.match(calendarPage, /calendarNewEventPath/);
    assert.match(calendarPage, /data-testid="event-new-link"/);
    assert.match(calendarPage, /currentView === "all"/);
    assert.match(calendarPage, /currentView === "availability"/);
  });

  it("shared calendar feeds point event links at the canonical calendar event routes", () => {
    const unifiedFeed = readFileSync("src/components/calendar/UnifiedEventFeed.tsx", "utf-8");
    const upcomingWidget = readFileSync("src/components/feed/UpcomingEventsWidget.tsx", "utf-8");

    assert.match(unifiedFeed, /calendarNewEventPath/);
    assert.match(unifiedFeed, /getUnifiedEventHref/);
    assert.match(upcomingWidget, /calendarEventsPath/);
    assert.match(upcomingWidget, /calendarEventDetailPath/);
  });

  it("org nav items only expose calendar as the schedule destination", () => {
    const navItems = readFileSync("src/lib/navigation/nav-items.tsx", "utf-8");

    assert.doesNotMatch(navItems, /href: "\/events"/);
    assert.match(navItems, /href: "\/calendar"/);
  });
});
