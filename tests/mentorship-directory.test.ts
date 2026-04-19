import test from "node:test";
import assert from "node:assert/strict";
import {
  applyFilters,
  emptyFilters,
  excludeSelf,
  hasActiveFilters,
  hasPendingRequest,
  type DirectoryFilters,
  type DirectoryMentorLike,
} from "../src/lib/mentorship/directory-helpers.ts";

function mentor(overrides: Partial<DirectoryMentorLike> & { user_id: string }): DirectoryMentorLike {
  return {
    name: overrides.name ?? overrides.user_id,
    industry: null,
    graduation_year: null,
    topics: [],
    sports: [],
    positions: [],
    accepting_new: true,
    ...overrides,
  };
}

function filters(overrides: Partial<DirectoryFilters> = {}): DirectoryFilters {
  return { ...emptyFilters(), ...overrides };
}

// ── excludeSelf ─────────────────────────────────────────────────────────────

test("excludeSelf drops the caller from their own directory view", () => {
  const m = [mentor({ user_id: "a" }), mentor({ user_id: "b" }), mentor({ user_id: "c" })];
  const out = excludeSelf(m, "b");
  assert.deepEqual(out.map((x) => x.user_id), ["a", "c"]);
});

test("excludeSelf is a no-op when currentUserId is empty", () => {
  const m = [mentor({ user_id: "a" })];
  assert.equal(excludeSelf(m, "").length, 1);
});

// ── hasPendingRequest ───────────────────────────────────────────────────────

test("hasPendingRequest returns true only for mentors with a pending pair", () => {
  assert.equal(hasPendingRequest(["m1", "m2"], "m1"), true);
  assert.equal(hasPendingRequest(["m1", "m2"], "m3"), false);
  assert.equal(hasPendingRequest([], "m1"), false);
});

// ── applyFilters ────────────────────────────────────────────────────────────

test("applyFilters: name search is case-insensitive substring match", () => {
  const m = [mentor({ user_id: "a", name: "Marcus" }), mentor({ user_id: "b", name: "Devon" })];
  assert.equal(applyFilters(m, filters({ nameSearch: "mar" })).length, 1);
  assert.equal(applyFilters(m, filters({ nameSearch: "MAR" })).length, 1);
  assert.equal(applyFilters(m, filters({ nameSearch: "carl" })).length, 0);
});

test("applyFilters: industry/year/topic equality filters", () => {
  const m = [
    mentor({ user_id: "a", industry: "Tech", graduation_year: 2020, topics: ["leadership"] }),
    mentor({ user_id: "b", industry: "Finance", graduation_year: 2018, topics: ["strategy"] }),
  ];
  assert.equal(applyFilters(m, filters({ industry: "Tech" })).length, 1);
  assert.equal(applyFilters(m, filters({ year: "2018" })).length, 1);
  assert.equal(applyFilters(m, filters({ topic: "leadership" })).length, 1);
});

test("applyFilters: sport/position filter checks native arrays", () => {
  const m = [
    mentor({ user_id: "a", sports: ["basketball"], positions: ["point-guard"] }),
    mentor({ user_id: "b", sports: ["football"], positions: ["quarterback"] }),
  ];
  assert.equal(applyFilters(m, filters({ sport: "basketball" }))[0].user_id, "a");
  assert.equal(applyFilters(m, filters({ position: "quarterback" }))[0].user_id, "b");
  assert.equal(applyFilters(m, filters({ sport: "soccer" })).length, 0);
});

test("applyFilters: acceptingOnly filters non-accepting mentors by default", () => {
  const m = [
    mentor({ user_id: "a", accepting_new: true }),
    mentor({ user_id: "b", accepting_new: false }),
  ];
  // default filters has acceptingOnly=true
  assert.deepEqual(applyFilters(m, filters()).map((x) => x.user_id), ["a"]);
  // unset acceptingOnly -> both visible
  assert.equal(applyFilters(m, filters({ acceptingOnly: false })).length, 2);
});

test("applyFilters: filters compose (AND across active filters)", () => {
  const m = [
    mentor({
      user_id: "a",
      name: "Marcus",
      industry: "Tech",
      sports: ["basketball"],
      positions: ["point-guard"],
    }),
    mentor({
      user_id: "b",
      name: "Devon",
      industry: "Tech",
      sports: ["football"],
      positions: ["quarterback"],
    }),
  ];
  // Tech + basketball -> only Marcus
  assert.deepEqual(
    applyFilters(m, filters({ industry: "Tech", sport: "basketball" })).map((x) => x.user_id),
    ["a"]
  );
});

// ── hasActiveFilters ────────────────────────────────────────────────────────

test("hasActiveFilters: defaults are inactive except acceptingOnly", () => {
  // default emptyFilters has acceptingOnly=true — that's the neutral state so
  // it must NOT count as "active" (UI uses this to toggle a Clear button)
  assert.equal(hasActiveFilters(emptyFilters()), false);
});

test("hasActiveFilters: any non-default filter flips it on", () => {
  assert.equal(hasActiveFilters(filters({ nameSearch: "x" })), true);
  assert.equal(hasActiveFilters(filters({ industry: "Tech" })), true);
  assert.equal(hasActiveFilters(filters({ year: "2020" })), true);
  assert.equal(hasActiveFilters(filters({ topic: "leadership" })), true);
  assert.equal(hasActiveFilters(filters({ sport: "basketball" })), true);
  assert.equal(hasActiveFilters(filters({ position: "point-guard" })), true);
  assert.equal(hasActiveFilters(filters({ acceptingOnly: false })), true);
});
