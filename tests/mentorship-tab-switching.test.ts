import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mentorshipTabShellSource = await readFile(
  new URL("../src/components/mentorship/MentorshipTabShell.tsx", import.meta.url),
  "utf8"
);

test("mentorship tab shell uses browser history instead of app router replacement", () => {
  assert.doesNotMatch(mentorshipTabShellSource, /router\.replace\(/);
  assert.match(mentorshipTabShellSource, /window\.history\.pushState\(/);
  assert.match(mentorshipTabShellSource, /window\.addEventListener\("popstate"/);
});
