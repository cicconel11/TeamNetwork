import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  rankMentorsForMentee,
  type MenteeInput,
  type MentorInput,
} from "../src/lib/mentorship/matching.ts";

const routeSource = await readFile(
  new URL(
    "../src/app/api/organizations/[organizationId]/mentorship/requests/route.ts",
    import.meta.url
  ),
  "utf8"
);

// ── Route-level invariants (rejection codes must be present + typed) ─────────

test("route returns self_request_blocked when mentor == mentee", () => {
  assert.match(routeSource, /self_request_blocked/);
  assert.match(routeSource, /body\.mentor_user_id === user\.id/);
});

test("route returns already_requested with pair_id for existing non-terminal pair", () => {
  assert.match(routeSource, /error_code: "already_requested"/);
  assert.match(routeSource, /pair_id: existing\.id/);
});

test("route emits 422 + error_code for each required-attribute rejection", () => {
  for (const code of [
    "same_sport_required",
    "same_position_required",
    "same_industry_required",
    "same_role_family_required",
  ]) {
    assert.match(routeSource, new RegExp(`error_code: "${code}"`));
  }
  // All four branches land on HTTP 422
  const count = (routeSource.match(/status: 422/g) ?? []).length;
  assert.ok(count >= 5, `expected >= 5 422s (self + 4 hard filters), got ${count}`);
});

test("route uses native preferences + mentor native arrays (no loadMenteeIntakeInput)", () => {
  assert.match(routeSource, /loadMenteePreferences/);
  assert.doesNotMatch(routeSource, /loadMenteeIntakeInput/);
  assert.match(routeSource, /nativeSports: mentorProfile\.sports/);
  assert.match(routeSource, /nativePositions: mentorProfile\.positions/);
  assert.match(routeSource, /extractMenteeSignals\(menteeInput\)/);
  assert.match(routeSource, /extractMentorSignals\(mentorInput\)/);
  assert.match(routeSource, /intersectNormalized\(mentorSignals\.industries, menteeSignals\.preferredIndustries\)/);
  assert.match(routeSource, /intersectNormalized\(mentorSignals\.roleFamilies, menteeSignals\.preferredRoleFamilies\)/);
});

// ── Matcher: self-exclude + hard filters ────────────────────────────────────

const ORG = "00000000-0000-0000-0000-000000000001";
const MENTOR = "00000000-0000-0000-0000-0000000000aa";
const MENTEE = "00000000-0000-0000-0000-0000000000bb";

function baseMentee(overrides: Partial<MenteeInput> = {}): MenteeInput {
  return {
    userId: MENTEE,
    orgId: ORG,
    focusAreas: ["leadership"],
    preferredIndustries: [],
    preferredRoleFamilies: [],
    preferredSports: [],
    preferredPositions: [],
    requiredMentorAttributes: [],
    currentCity: null,
    graduationYear: null,
    currentCompany: null,
    ...overrides,
  };
}

function baseMentor(overrides: Partial<MentorInput> = {}): MentorInput {
  return {
    userId: MENTOR,
    orgId: ORG,
    topics: ["leadership"],
    expertiseAreas: [],
    nativeSports: [],
    nativePositions: [],
    nativeIndustries: [],
    nativeRoleFamilies: [],
    industry: null,
    jobTitle: null,
    positionTitle: null,
    currentCompany: null,
    currentCity: null,
    graduationYear: null,
    maxMentees: 3,
    currentMenteeCount: 0,
    acceptingNew: true,
    isActive: true,
    ...overrides,
  };
}

test("matcher excludes self (mentor_user_id == mentee.userId)", () => {
  // Same id: matching must drop the row so it never reaches the UI.
  const selfMentor = baseMentor({ userId: MENTEE });
  const matches = rankMentorsForMentee(baseMentee(), [selfMentor]);
  assert.equal(matches.length, 0);
});

test("same_sport required: blocks when mentor native sports do not intersect", () => {
  const mentee = baseMentee({
    preferredSports: ["basketball"],
    requiredMentorAttributes: ["same_sport"],
  });
  const mentor = baseMentor({ nativeSports: ["football"] });
  assert.equal(rankMentorsForMentee(mentee, [mentor]).length, 0);
});

test("same_sport required: allows when mentor native sports intersect", () => {
  const mentee = baseMentee({
    preferredSports: ["basketball"],
    requiredMentorAttributes: ["same_sport"],
  });
  const mentor = baseMentor({ nativeSports: ["basketball"] });
  const m = rankMentorsForMentee(mentee, [mentor]);
  assert.equal(m.length, 1);
  assert.ok(m[0].signals.some((s) => s.code === "shared_sport"));
});

test("same_position required: blocks when mentor native positions do not intersect", () => {
  const mentee = baseMentee({
    preferredPositions: ["point-guard"],
    requiredMentorAttributes: ["same_position"],
  });
  const mentor = baseMentor({ nativePositions: ["quarterback"] });
  assert.equal(rankMentorsForMentee(mentee, [mentor]).length, 0);
});

test("same_industry required: blocks when mentor industries do not include mentee preferred", () => {
  const mentee = baseMentee({
    preferredIndustries: ["Technology"],
    requiredMentorAttributes: ["same_industry"],
  });
  const mentor = baseMentor({ nativeIndustries: ["Finance"] });
  assert.equal(rankMentorsForMentee(mentee, [mentor]).length, 0);
});

test("same_role_family required: blocks when mentor role_families do not include mentee preferred", () => {
  const mentee = baseMentee({
    preferredRoleFamilies: ["Engineering"],
    requiredMentorAttributes: ["same_role_family"],
  });
  const mentor = baseMentor({ nativeRoleFamilies: ["Finance"] });
  assert.equal(rankMentorsForMentee(mentee, [mentor]).length, 0);
});

test("happy path: mentor shares sport + position populates signals", () => {
  const mentee = baseMentee({
    preferredSports: ["basketball"],
    preferredPositions: ["point-guard"],
  });
  const mentor = baseMentor({
    nativeSports: ["basketball"],
    nativePositions: ["point-guard"],
  });
  const m = rankMentorsForMentee(mentee, [mentor]);
  assert.equal(m.length, 1);
  const codes = new Set(m[0].signals.map((s) => s.code));
  assert.ok(codes.has("shared_sport"));
  assert.ok(codes.has("shared_position"));
});

test("native sports authoritative over regex-derived (empty topics/job ignored)", () => {
  // jobTitle "Quarterback" would regex-derive sports=football, but native
  // sports=basketball must win.
  const mentee = baseMentee({ preferredSports: ["basketball"] });
  const mentor = baseMentor({
    nativeSports: ["basketball"],
    jobTitle: "Quarterback",
  });
  const m = rankMentorsForMentee(mentee, [mentor]);
  assert.equal(m.length, 1);
  const sportSig = m[0].signals.find((s) => s.code === "shared_sport");
  assert.ok(sportSig);
  assert.equal(sportSig!.value, "basketball");
});

test("same_industry required: native secondary industry still satisfies matcher", () => {
  const mentee = baseMentee({
    preferredIndustries: ["Technology"],
    requiredMentorAttributes: ["same_industry"],
  });
  const mentor = baseMentor({
    nativeIndustries: ["Finance", "Technology"],
  });
  const matches = rankMentorsForMentee(mentee, [mentor]);
  assert.equal(matches.length, 1);
  assert.ok(matches[0].signals.some((signal) => signal.code === "shared_industry"));
});

test("same_role_family required: native secondary role family still satisfies matcher", () => {
  const mentee = baseMentee({
    preferredRoleFamilies: ["Engineering"],
    requiredMentorAttributes: ["same_role_family"],
  });
  const mentor = baseMentor({
    nativeRoleFamilies: ["Finance", "Engineering"],
  });
  const matches = rankMentorsForMentee(mentee, [mentor]);
  assert.equal(matches.length, 1);
  assert.ok(matches[0].signals.some((signal) => signal.code === "shared_role_family"));
});
