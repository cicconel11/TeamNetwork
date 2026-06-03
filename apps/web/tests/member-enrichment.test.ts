import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveMemberExperience,
  resolveMemberEducation,
  resolveMemberBio,
} from "@/lib/profile/member-enrichment";

// Regression: member profiles rendered only one logo-less job unless the person
// personally OAuth-connected LinkedIn, because experience/education/bio read only
// the `user_linkedin_connections.linkedin_data.enrichment` blob and ignored the
// admin-enriched `members` columns. These tests pin the blob → column fallback.

const blobExperience = [
  { title: "AI Engineer", company: "Glia", company_logo_url: "https://logo/glia.png" },
  { title: "Intern", company: "Acme", company_logo_url: null },
];
const columnExperience = [
  { title: "Software Engineer", company: "Palo Alto Networks", company_logo_url: "https://logo/pan.png" },
  { title: "SWE Intern", company: "Initech", company_logo_url: "https://logo/initech.png" },
  { title: "TA", company: "State U", company_logo_url: null },
];

test("experience: prefers the self-connection blob when present", () => {
  const result = resolveMemberExperience(
    { experience: blobExperience },
    { work_history: columnExperience },
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].company, "Glia");
});

test("experience: falls back to members.work_history when blob is absent", () => {
  const result = resolveMemberExperience(null, { work_history: columnExperience });
  assert.equal(result.length, 3);
  assert.equal(result[0].company, "Palo Alto Networks");
  assert.equal(result[0].company_logo_url, "https://logo/pan.png");
});

test("experience: falls back when blob exists but has an empty experience array", () => {
  const result = resolveMemberExperience(
    { experience: [] },
    { work_history: columnExperience },
  );
  assert.equal(result.length, 3);
});

test("experience: returns [] when neither source has data", () => {
  assert.deepEqual(resolveMemberExperience(null, {}), []);
  assert.deepEqual(resolveMemberExperience({ experience: null }, { work_history: null }), []);
});

test("education: prefers blob, falls back to members.education_history", () => {
  const blobEdu = [{ title: "MIT", degree: "BS" }];
  const colEdu = [{ title: "State U", degree: "BA" }];
  assert.equal(resolveMemberEducation({ education: blobEdu }, { education_history: colEdu })[0].title, "MIT");
  assert.equal(resolveMemberEducation(null, { education_history: colEdu })[0].title, "State U");
  assert.equal(resolveMemberEducation({ education: [] }, { education_history: colEdu })[0].title, "State U");
});

test("bio: prefers blob about/summary, falls back to member summary then headline", () => {
  assert.equal(resolveMemberBio({ about: "blob about" }, { summary: "col summary" }), "blob about");
  assert.equal(resolveMemberBio({ summary: "blob summary" }, { summary: "col summary" }), "blob summary");
  assert.equal(resolveMemberBio(null, { summary: "col summary", headline: "head" }), "col summary");
  assert.equal(resolveMemberBio(null, { headline: "head" }), "head");
  assert.equal(resolveMemberBio(null, {}), null);
});
