/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  damerauLevenshtein,
  findBestProjectedPersonNameMatches,
  scoreProjectedPersonNameMatch,
} from "../src/lib/falkordb/name-matching.ts";
import type { ProjectedPerson } from "../src/lib/falkordb/people.ts";

function person(name: string, id = name.toLowerCase().replace(/\s+/g, "-")): ProjectedPerson {
  return {
    orgId: "org1",
    personKey: `member:${id}`,
    personType: "member",
    personId: id,
    memberId: id,
    alumniId: null,
    userId: null,
    name,
    email: null,
    role: null,
    major: null,
    currentCompany: null,
    industry: null,
    roleFamily: null,
    graduationYear: null,
    currentCity: null,
  };
}

describe("damerauLevenshtein", () => {
  it("returns 0 for identical strings", () => {
    assert.equal(damerauLevenshtein("frank", "frank"), 0);
  });

  it("counts single insertion", () => {
    assert.equal(damerauLevenshtein("cicone", "ciccone"), 1);
  });

  it("counts transposition as 1", () => {
    assert.equal(damerauLevenshtein("leonard", "leoanrd"), 1);
  });

  it("counts 2 edits", () => {
    assert.equal(damerauLevenshtein("abc", "axy"), 2);
  });
});

describe("scoreProjectedPersonNameMatch fuzzy branch", () => {
  it("matches 'Frank Cicone' to 'Frank Ciccone' as near-miss (score <50)", () => {
    const score = scoreProjectedPersonNameMatch("Frank Cicone", person("Frank Ciccone"));
    assert.ok(score > 0 && score < 50, `expected near-miss band, got ${score}`);
  });

  it("still matches alias path 'Matt Leonard' vs 'Matthew Leonard'", () => {
    const score = scoreProjectedPersonNameMatch("Matt Leonard", person("Matthew Leonard"));
    assert.equal(score, 85);
  });

  it("returns 0 for unrelated names", () => {
    const score = scoreProjectedPersonNameMatch("XYZ Abc", person("Frank Ciccone"));
    assert.equal(score, 0);
  });

  it("does not fuzzy-match tokens shorter than 4 chars (false-positive guard)", () => {
    // "Bob Cat" vs "Bob Bat" — last tokens 3 chars each, 1 edit apart.
    // Must stay 0 (too short).
    const score = scoreProjectedPersonNameMatch("Bob Cat", person("Bob Bat"));
    assert.equal(score, 0);
  });

  it("allows 2 edits on long (>=7 char) last name", () => {
    // ciccone (7) vs ciccoex — distance 2 (two substitutions)
    assert.equal(damerauLevenshtein("ciccoex", "ciccone"), 2);
    const score = scoreProjectedPersonNameMatch("Frank Ciccoex", person("Frank Ciccone"));
    assert.ok(score > 0, `expected fuzzy hit, got ${score}`);
  });
});

describe("findBestProjectedPersonNameMatches", () => {
  it("surfaces fuzzy near-miss in sorted result list", () => {
    const people = [person("Frank Ciccone"), person("Alice Stone"), person("Bob Zzzz")];
    const matches = findBestProjectedPersonNameMatches(people, "Frank Cicone");
    assert.ok(matches.length >= 1);
    assert.equal(matches[0].person.name, "Frank Ciccone");
    assert.ok(matches[0].score > 0 && matches[0].score < 50);
  });
});
