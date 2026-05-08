import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeEventStatus,
  formatCountdown,
  getEventStatus,
} from "@teammeet/core/calendar";

const start = new Date("2026-05-08T20:00:00Z");
const end = new Date("2026-05-08T21:00:00Z");
const startIso = start.toISOString();
const endIso = end.toISOString();

function at(offsetMs: number): Date {
  return new Date(start.getTime() + offsetMs);
}

test("upcoming when more than 15 minutes before start", () => {
  const status = getEventStatus(startIso, endIso, at(-16 * 60 * 1000));
  assert.equal(status.kind, "upcoming");
  if (status.kind === "upcoming") {
    assert.equal(status.secondsUntilStart, 16 * 60);
  }
});

test("starting-soon at exactly 15 minutes before start", () => {
  const status = getEventStatus(startIso, endIso, at(-15 * 60 * 1000));
  assert.equal(status.kind, "starting-soon");
});

test("starting-soon 1 second before start", () => {
  const status = getEventStatus(startIso, endIso, at(-1000));
  assert.equal(status.kind, "starting-soon");
});

test("live at start instant", () => {
  const status = getEventStatus(startIso, endIso, at(0));
  assert.equal(status.kind, "live");
  if (status.kind === "live") {
    assert.equal(status.secondsUntilEnd, 60 * 60);
  }
});

test("live one second before end", () => {
  const status = getEventStatus(startIso, endIso, at(60 * 60 * 1000 - 1000));
  assert.equal(status.kind, "live");
});

test("recently-ended at end instant", () => {
  const status = getEventStatus(startIso, endIso, at(60 * 60 * 1000));
  assert.equal(status.kind, "recently-ended");
});

test("recently-ended within grace window", () => {
  const status = getEventStatus(startIso, endIso, at(90 * 60 * 1000 - 1000));
  assert.equal(status.kind, "recently-ended");
});

test("past once grace window expires", () => {
  const status = getEventStatus(startIso, endIso, at(90 * 60 * 1000 + 1000));
  assert.equal(status.kind, "past");
});

test("custom grace period overrides default", () => {
  const status = getEventStatus(
    startIso,
    endIso,
    at(60 * 60 * 1000 + 5 * 60 * 1000),
    1, // 1 minute grace
  );
  assert.equal(status.kind, "past");
});

test("null endAt assumes 60 minute duration", () => {
  const status = getEventStatus(startIso, null, at(30 * 60 * 1000));
  assert.equal(status.kind, "live");
  if (status.kind === "live") {
    assert.equal(status.secondsUntilEnd, null);
  }
});

test("formatCountdown thresholds", () => {
  assert.equal(formatCountdown(0), "0s");
  assert.equal(formatCountdown(45), "45s");
  assert.equal(formatCountdown(59), "59s");
  assert.equal(formatCountdown(60), "1m");
  assert.equal(formatCountdown(720), "12m");
  assert.equal(formatCountdown(60 * 60), "1h");
  assert.equal(formatCountdown(60 * 60 + 5 * 60), "1h 5m");
  assert.equal(formatCountdown(24 * 60 * 60), "1d");
  assert.equal(formatCountdown(25 * 60 * 60), "1d 1h");
});

test("describeEventStatus surfaces direction", () => {
  assert.equal(
    describeEventStatus({ kind: "starting-soon", secondsUntilStart: 5 * 60 }),
    "Starts in 5m",
  );
  assert.equal(
    describeEventStatus({ kind: "live", secondsUntilEnd: 30 * 60 }),
    "Live · 30m left",
  );
  assert.equal(
    describeEventStatus({ kind: "live", secondsUntilEnd: null }),
    "Live now",
  );
  assert.equal(
    describeEventStatus({ kind: "recently-ended", secondsSinceEnd: 60 }),
    "Just ended",
  );
});
