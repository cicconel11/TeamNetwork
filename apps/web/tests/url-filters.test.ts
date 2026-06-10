import test from "node:test";
import assert from "node:assert/strict";
import {
  buildUrlFilterQuery,
  clearedUrlFilters,
  countActiveUrlFilters,
  readUrlFilters,
} from "@/lib/url-filters";

const KEYS = ["q", "type", "level", "location"] as const;

test("readUrlFilters reads each key from search params", () => {
  const params = new URLSearchParams("q=engineer&type=remote&level=senior&location=NYC");
  assert.deepEqual(readUrlFilters(KEYS, params), {
    q: "engineer",
    type: "remote",
    level: "senior",
    location: "NYC",
  });
});

test("readUrlFilters defaults missing and empty params to empty string", () => {
  const params = new URLSearchParams("q=&type=remote");
  assert.deepEqual(readUrlFilters(KEYS, params), {
    q: "",
    type: "remote",
    level: "",
    location: "",
  });
});

test("readUrlFilters ignores params outside the key list", () => {
  const params = new URLSearchParams("type=remote&page=3&utm_source=x");
  const filters = readUrlFilters(KEYS, params);
  assert.deepEqual(Object.keys(filters).sort(), [...KEYS].sort());
  assert.equal(filters.type, "remote");
});

test("buildUrlFilterQuery emits params in key order and drops empty values", () => {
  const query = buildUrlFilterQuery(KEYS, {
    q: "",
    type: "remote",
    level: "senior",
    location: "",
  });
  assert.equal(query, "type=remote&level=senior");
});

test("buildUrlFilterQuery preserves key order regardless of object property order", () => {
  const query = buildUrlFilterQuery(KEYS, {
    location: "NYC",
    level: "",
    type: "hybrid",
    q: "designer",
  });
  assert.equal(query, "q=designer&type=hybrid&location=NYC");
});

test("buildUrlFilterQuery returns empty string when no filters are active", () => {
  assert.equal(buildUrlFilterQuery(KEYS, clearedUrlFilters(KEYS)), "");
});

test("buildUrlFilterQuery URL-encodes values like the legacy URLSearchParams builders", () => {
  const query = buildUrlFilterQuery(["student_name"] as const, {
    student_name: "Anna & Bo Smith",
  });
  assert.equal(query, "student_name=Anna+%26+Bo+Smith");
  assert.equal(
    new URLSearchParams(query).get("student_name"),
    "Anna & Bo Smith",
  );
});

test("buildUrlFilterQuery never emits keys outside the list (pagination reset)", () => {
  const filters = {
    type: "remote",
    page: "4",
  } as Record<string, string>;
  assert.equal(buildUrlFilterQuery(["type"] as const, filters), "type=remote");
});

test("clearedUrlFilters resets every key to empty string", () => {
  assert.deepEqual(clearedUrlFilters(KEYS), {
    q: "",
    type: "",
    level: "",
    location: "",
  });
});

test("countActiveUrlFilters counts only non-empty values", () => {
  assert.equal(countActiveUrlFilters({ a: "", b: "x", c: "y", d: "" }), 2);
  assert.equal(countActiveUrlFilters(clearedUrlFilters(KEYS)), 0);
});

test("round trip: read -> build reproduces the original query", () => {
  const original = "year=2020&birthYear=1998&company=Acme";
  const keys = ["year", "birthYear", "industry", "company", "city", "position"] as const;
  const filters = readUrlFilters(keys, new URLSearchParams(original));
  assert.equal(buildUrlFilterQuery(keys, filters), original);
});
