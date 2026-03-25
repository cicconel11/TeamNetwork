import test from "node:test";
import assert from "node:assert/strict";
import type { ProjectedPerson } from "../src/lib/falkordb/people.ts";
import {
  findBestProjectedPersonNameMatches,
  normalizeHumanNameText,
  scoreProjectedPersonNameMatch,
} from "../src/lib/falkordb/name-matching.ts";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

function makeProjectedPerson(
  overrides: Partial<ProjectedPerson> & Pick<ProjectedPerson, "personKey" | "personId" | "name">
): ProjectedPerson {
  return {
    orgId: ORG_ID,
    personKey: overrides.personKey,
    personType: overrides.personType ?? "member",
    personId: overrides.personId,
    memberId: overrides.memberId ?? overrides.personId,
    alumniId: overrides.alumniId ?? null,
    userId: overrides.userId ?? null,
    name: overrides.name,
    email: overrides.email ?? null,
    role: overrides.role ?? null,
    major: overrides.major ?? null,
    currentCompany: overrides.currentCompany ?? null,
    industry: overrides.industry ?? null,
    roleFamily: overrides.roleFamily ?? null,
    graduationYear: overrides.graduationYear ?? null,
    currentCity: overrides.currentCity ?? null,
  };
}

test("normalizeHumanNameText strips punctuation and normalizes spacing", () => {
  assert.equal(normalizeHumanNameText("  Matt   Leonard, "), "matt leonard");
  assert.equal(normalizeHumanNameText("Matt O'Neil"), "matt o neil");
});

test("scoreProjectedPersonNameMatch supports Matt-family aliases and shorthand prefixes", () => {
  const mattLeonard = makeProjectedPerson({
    personKey: "member:matt",
    personId: "member-matt",
    name: "Matt Leonard",
  });

  assert.equal(scoreProjectedPersonNameMatch("Matthew Leonard", mattLeonard), 85);
  assert.equal(scoreProjectedPersonNameMatch("Mat Leonard", mattLeonard), 85);
  assert.equal(scoreProjectedPersonNameMatch("mat leo", mattLeonard), 65);
  assert.equal(scoreProjectedPersonNameMatch("matt leo", mattLeonard), 75);
});

test("scoreProjectedPersonNameMatch does not overmatch weak or single-token queries", () => {
  const mattLeonard = makeProjectedPerson({
    personKey: "member:matt",
    personId: "member-matt",
    name: "Matt Leonard",
  });

  assert.equal(scoreProjectedPersonNameMatch("matt", mattLeonard), 0);
  assert.equal(scoreProjectedPersonNameMatch("mat smith", mattLeonard), 0);
  assert.equal(scoreProjectedPersonNameMatch("ma le", mattLeonard), 50);
});

test("findBestProjectedPersonNameMatches sorts by score then identity", () => {
  const matches = findBestProjectedPersonNameMatches(
    [
      makeProjectedPerson({
        personKey: "member:matt",
        personId: "member-matt",
        name: "Matt Leonard",
      }),
      makeProjectedPerson({
        personKey: "member:matthew",
        personId: "member-matthew",
        name: "Matthew Leonard",
      }),
      makeProjectedPerson({
        personKey: "member:mark",
        personId: "member-mark",
        name: "Mark Lewis",
      }),
    ],
    "mat leo"
  );

  assert.deepEqual(
    matches.map((match) => ({ name: match.person.name, score: match.score })),
    [
      { name: "Matt Leonard", score: 65 },
      { name: "Matthew Leonard", score: 65 },
    ]
  );
});
