import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calendarEventDetailPath,
  calendarEventEditPath,
  calendarEventsPath,
  calendarListPath,
  calendarMySettingsPath,
  calendarNewEventPath,
  calendarNewSchedulePath,
  calendarSourcesPath,
} from "../src/lib/calendar/routes";
import { parseCalendarEventTimeframe, parseCalendarView } from "../src/lib/calendar/view-state";

describe("calendar event routes", () => {
  const orgSlug = "acme";

  it("builds canonical calendar section paths", () => {
    assert.equal(calendarListPath(orgSlug), "/acme/calendar?subview=list");
    assert.equal(calendarEventsPath(orgSlug), "/acme/calendar?subview=list");
    assert.equal(calendarEventsPath(orgSlug, { timeframe: "past" }), "/acme/calendar?subview=list&timeframe=past");
    assert.equal(calendarEventsPath(orgSlug, { type: "meeting" }), "/acme/calendar?subview=list&type=meeting");
    assert.equal(calendarSourcesPath(orgSlug), "/acme/calendar/sources");
    assert.equal(calendarMySettingsPath(orgSlug), "/acme/calendar/my-settings");
    assert.equal(calendarNewSchedulePath(orgSlug), "/acme/calendar/new");
    assert.equal(calendarNewEventPath(orgSlug), "/acme/calendar/events/new");
    assert.equal(calendarEventDetailPath(orgSlug, "evt_123"), "/acme/calendar/events/evt_123");
    assert.equal(calendarEventEditPath(orgSlug, "evt_123"), "/acme/calendar/events/evt_123/edit");
  });

  it("parses calendar surface views with calendar as the default", () => {
    assert.equal(parseCalendarView(undefined), "calendar");
    assert.equal(parseCalendarView("events"), "calendar");
    assert.equal(parseCalendarView("all"), "calendar");
    assert.equal(parseCalendarView("availability"), "availability");
    assert.equal(parseCalendarView("unexpected"), "calendar");
  });

  it("parses event timeframe with upcoming as the default", () => {
    assert.equal(parseCalendarEventTimeframe(undefined), "upcoming");
    assert.equal(parseCalendarEventTimeframe("past"), "past");
    assert.equal(parseCalendarEventTimeframe("upcoming"), "upcoming");
    assert.equal(parseCalendarEventTimeframe("anything-else"), "upcoming");
  });
});

