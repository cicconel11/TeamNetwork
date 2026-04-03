import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getCalendarPrimaryActionHref,
  getTeamEventCreationHref,
  getUnifiedEventHref,
} from "@/lib/calendar/navigation";

describe("calendar navigation helpers", () => {
  it("routes the main calendar CTA to the member schedule form", () => {
    assert.equal(getCalendarPrimaryActionHref("acme"), "/acme/calendar/new");
  });

  it("routes the unified feed empty-state team event CTA to the event form", () => {
    assert.equal(getTeamEventCreationHref("acme"), "/acme/events/new");
  });

  it("routes team events to the event detail page", () => {
    assert.equal(
      getUnifiedEventHref("acme", { sourceType: "event", eventId: "event-1" }),
      "/acme/events/event-1",
    );
  });

  it("falls back to the unified event id when the explicit eventId is missing", () => {
    assert.equal(
      getUnifiedEventHref("acme", { sourceType: "event", id: "event:event-1" }),
      "/acme/events/event-1",
    );
  });

  it("does not deep-link date-only team events until the event pages handle them safely", () => {
    assert.equal(
      getUnifiedEventHref("acme", {
        sourceType: "event",
        eventId: "event-1",
        startAt: "2026-03-30",
        allDay: true,
      }),
      null,
    );
  });

  it("routes academic schedule entries to the schedule edit page", () => {
    assert.equal(
      getUnifiedEventHref("acme", { sourceType: "class", academicScheduleId: "sched-1" }),
      "/acme/calendar/sched-1/edit",
    );
  });

  it("falls back to the unified class id when the explicit schedule id is missing", () => {
    assert.equal(
      getUnifiedEventHref("acme", { sourceType: "class", id: "class:sched-1:2026-03-30" }),
      "/acme/calendar/sched-1/edit",
    );
  });

  it("does not create bogus edit links for imported schedule rows", () => {
    assert.equal(getUnifiedEventHref("acme", { sourceType: "schedule" }), null);
    assert.equal(getUnifiedEventHref("acme", { sourceType: "feed" }), null);
  });
});
