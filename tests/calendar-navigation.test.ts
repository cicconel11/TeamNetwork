import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getCalendarPrimaryActionHref, getUnifiedEventHref } from "@/lib/calendar/navigation";

describe("calendar navigation helpers", () => {
  it("routes the main calendar CTA to event creation", () => {
    assert.equal(getCalendarPrimaryActionHref("acme"), "/acme/events/new");
  });

  it("routes team events to the event detail page", () => {
    assert.equal(
      getUnifiedEventHref("acme", { sourceType: "event", eventId: "event-1" }),
      "/acme/events/event-1",
    );
  });

  it("routes academic schedule entries to the schedule edit page", () => {
    assert.equal(
      getUnifiedEventHref("acme", { sourceType: "class", academicScheduleId: "sched-1" }),
      "/acme/calendar/sched-1/edit",
    );
  });

  it("does not create bogus edit links for imported schedule rows", () => {
    assert.equal(getUnifiedEventHref("acme", { sourceType: "schedule" }), null);
    assert.equal(getUnifiedEventHref("acme", { sourceType: "feed" }), null);
  });
});
