import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calendarAllPath,
  calendarAvailabilityPath,
  calendarEventDetailPath,
  calendarEventEditPath,
  calendarEventsPath,
  calendarMySettingsPath,
  calendarNewEventPath,
  calendarNewSchedulePath,
  calendarRootPath,
  calendarSourcesPath,
} from "../src/lib/calendar/routes";
import { parseCalendarEventTimeframe, parseCalendarView } from "../src/lib/calendar/view-state";

describe("calendar event routes", () => {
  const orgSlug = "acme";

  it("builds canonical calendar section paths", () => {
    assert.equal(calendarRootPath(orgSlug), "/acme/calendar");
    assert.equal(calendarEventsPath(orgSlug), "/acme/calendar");
    assert.equal(calendarEventsPath(orgSlug, { timeframe: "past" }), "/acme/calendar?timeframe=past");
    assert.equal(calendarEventsPath(orgSlug, { type: "meeting" }), "/acme/calendar?type=meeting");
    assert.equal(calendarAllPath(orgSlug), "/acme/calendar?view=all");
    assert.equal(calendarAvailabilityPath(orgSlug), "/acme/calendar?view=availability");
    assert.equal(calendarSourcesPath(orgSlug), "/acme/calendar/sources");
    assert.equal(calendarMySettingsPath(orgSlug), "/acme/calendar/my-settings");
    assert.equal(calendarNewSchedulePath(orgSlug), "/acme/calendar/new");
    assert.equal(calendarNewEventPath(orgSlug), "/acme/calendar/events/new");
    assert.equal(calendarEventDetailPath(orgSlug, "evt_123"), "/acme/calendar/events/evt_123");
    assert.equal(calendarEventEditPath(orgSlug, "evt_123"), "/acme/calendar/events/evt_123/edit");
  });

  it("parses calendar surface views with events as the default", () => {
    assert.equal(parseCalendarView(undefined), "events");
    assert.equal(parseCalendarView("events"), "events");
    assert.equal(parseCalendarView("all"), "all");
    assert.equal(parseCalendarView("availability"), "availability");
    assert.equal(parseCalendarView("unexpected"), "events");
  });

  it("parses event timeframe with upcoming as the default", () => {
    assert.equal(parseCalendarEventTimeframe(undefined), "upcoming");
    assert.equal(parseCalendarEventTimeframe("past"), "past");
    assert.equal(parseCalendarEventTimeframe("upcoming"), "upcoming");
    assert.equal(parseCalendarEventTimeframe("anything-else"), "upcoming");
  });
});

