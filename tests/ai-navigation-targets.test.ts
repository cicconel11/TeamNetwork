import test from "node:test";
import assert from "node:assert/strict";
import { searchNavigationTargets } from "../src/lib/ai/navigation-targets.ts";

test("searchNavigationTargets finds create targets for create-intent queries", () => {
  const result = searchNavigationTargets({
    query: "create announcement",
    orgSlug: "acme",
    role: "admin",
  });

  assert.equal(result.state, "resolved");
  assert.equal(result.matches[0]?.label, "New Announcement");
  assert.equal(result.matches[0]?.href, "/acme/announcements/new");
  assert.equal(result.matches[0]?.userCanAccess, true);
  assert.match(result.matches[0]?.manualSteps[0] ?? "", /create form/i);
  assert.match(result.matches[0]?.assistantCanHelpWith[0] ?? "", /draft/i);
});

test("searchNavigationTargets finds page targets for open-page queries", () => {
  const result = searchNavigationTargets({
    query: "open members",
    orgSlug: "acme",
    role: "admin",
  });

  assert.equal(result.state, "resolved");
  assert.equal(result.matches[0]?.label, "Members");
  assert.equal(result.matches[0]?.href, "/acme/members");
  assert.equal(result.matches[0]?.userCanAccess, true);
  assert.match(result.matches[0]?.manualSteps[0] ?? "", /members page/i);
  assert.match(result.matches[0]?.assistantCanHelpWith[0] ?? "", /List members/i);
});

test("searchNavigationTargets returns not_found for unrelated queries", () => {
  const result = searchNavigationTargets({
    query: "quantum grapes",
    orgSlug: "acme",
    role: "admin",
  });

  assert.equal(result.state, "not_found");
  assert.deepEqual(result.matches, []);
});

test("searchNavigationTargets excludes nav items hidden for the current org state", () => {
  const result = searchNavigationTargets({
    query: "open alumni",
    orgSlug: "acme",
    role: "admin",
    hasAlumniAccess: false,
  });

  assert.equal(result.state, "not_found");
});

test("searchNavigationTargets drops create targets when query lacks create intent", () => {
  const result = searchNavigationTargets({
    query: "where is the jobs page",
    orgSlug: "acme",
    role: "admin",
  });

  assert.equal(result.state, "resolved");
  assert.ok(
    result.matches.every((match) => match.kind !== "create"),
    "no create-kind target should be returned without create intent"
  );
});

test("searchNavigationTargets returns only the dominant match when score gap is large", () => {
  const result = searchNavigationTargets({
    query: "open members",
    orgSlug: "acme",
    role: "admin",
  });

  assert.equal(result.state, "resolved");
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.href, "/acme/members");
});

test("searchNavigationTargets excludes nav items hidden by nav config", () => {
  const result = searchNavigationTargets({
    query: "open announcements",
    orgSlug: "acme",
    role: "admin",
    navConfig: {
      "/announcements": { hidden: true },
    },
  });

  assert.equal(result.state, "not_found");
});
