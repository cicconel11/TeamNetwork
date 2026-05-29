import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeApifyItem,
  mapApifyToFields,
  getApifyProfileUrlKey,
} from "@/lib/linkedin/apify";

// Mirrors the dev_fusion/linkedin-profile-scraper output shape that
// normalizeApifyItem targets. Exercises the richer fields added in the Apify
// migration (skills, certifications, languages, photo, industry).
const APIFY_ITEM = {
  linkedinUrl: "https://www.linkedin.com/in/jane-doe/",
  fullName: "Jane Doe",
  firstName: "Jane",
  lastName: "Doe",
  headline: "Staff Engineer at Acme",
  about: "Builds reliable systems.",
  industry: "Software Development",
  companyName: "Acme",
  addressWithoutCountry: "San Francisco, California",
  profilePicHighQuality: "https://media.licdn.com/photo/jane.jpg",
  experiences: [
    {
      title: "Staff Engineer",
      companyName: "Acme",
      location: "San Francisco",
      startDate: "2022",
      endDate: null,
      description: "<p>Leads platform work.</p>",
    },
    {
      title: "Senior Engineer",
      companyName: "Globex",
      startDate: "2018",
      endDate: "2022",
    },
  ],
  educations: [
    { title: "MIT", degree: "BSc", fieldOfStudy: "Computer Science", startYear: "2014", endYear: "2018" },
  ],
  skills: ["TypeScript", "Distributed Systems", { name: "Postgres" }],
  licenseAndCertificates: [
    { title: "AWS Solutions Architect", authority: "Amazon Web Services" },
  ],
  languages: ["English", "Spanish"],
};

test("normalizeApifyItem maps the actor payload into the neutral profile shape", () => {
  const profile = normalizeApifyItem(APIFY_ITEM);
  assert.ok(profile);
  assert.equal(profile.name, "Jane Doe");
  assert.equal(profile.headline, "Staff Engineer at Acme");
  assert.equal(profile.summary, "Builds reliable systems.");
  assert.equal(profile.industry, "Software Development");
  assert.equal(profile.current_company, "Acme");
  assert.equal(profile.city, "San Francisco, California");
  assert.equal(profile.photo_url, "https://media.licdn.com/photo/jane.jpg");
  assert.equal(profile.experience.length, 2);
  // Rich HTML descriptions are sanitized to plain text.
  assert.equal(profile.experience[0].description, "Leads platform work.");
  assert.deepEqual(profile.skills, ["TypeScript", "Distributed Systems", "Postgres"]);
  assert.deepEqual(profile.certifications, [
    { name: "AWS Solutions Architect", authority: "Amazon Web Services" },
  ]);
  assert.deepEqual(profile.languages, ["English", "Spanish"]);
});

test("mapApifyToFields derives current role from the open-ended experience", () => {
  const profile = normalizeApifyItem(APIFY_ITEM);
  assert.ok(profile);
  const fields = mapApifyToFields(profile);

  assert.equal(fields.job_title, "Staff Engineer");
  assert.equal(fields.position_title, "Staff Engineer");
  assert.equal(fields.current_company, "Acme");
  assert.equal(fields.industry, "Software Development");
  assert.equal(fields.current_city, "San Francisco, California");
  assert.equal(fields.school, "MIT");
  assert.equal(fields.major, "BSc");
  assert.equal(fields.photo_url, "https://media.licdn.com/photo/jane.jpg");
  assert.equal(fields.work_history?.length, 2);
  assert.equal(fields.education_history?.length, 1);
  assert.deepEqual(fields.skills, ["TypeScript", "Distributed Systems", "Postgres"]);
  assert.deepEqual(fields.languages, ["English", "Spanish"]);
  assert.equal(fields.certifications?.[0]?.name, "AWS Solutions Architect");
});

test("mapApifyToFields nulls empty list fields instead of writing empty arrays", () => {
  const profile = normalizeApifyItem({
    fullName: "No Lists",
    headline: "Consultant",
  });
  assert.ok(profile);
  const fields = mapApifyToFields(profile);
  assert.equal(fields.skills, null);
  assert.equal(fields.certifications, null);
  assert.equal(fields.languages, null);
  assert.equal(fields.work_history, null);
  assert.equal(fields.education_history, null);
  // Headline still drives the derived title even without experience rows.
  assert.equal(fields.job_title, "Consultant");
});

test("normalizeApifyItem falls back to companyIndustry when no top-level industry", () => {
  // The dev_fusion actor returns `companyIndustry` (e.g. "Computer Software"),
  // not a top-level `industry` — verified against a live run.
  const profile = normalizeApifyItem({
    fullName: "Industry Person",
    headline: "Engineer",
    companyIndustry: "Computer Software",
  });
  assert.ok(profile);
  assert.equal(profile.industry, "Computer Software");
  assert.equal(mapApifyToFields(profile).industry, "Computer Software");
});

test("normalizeApifyItem rejects payloads with no identifying fields", () => {
  assert.equal(normalizeApifyItem({}), null);
  assert.equal(normalizeApifyItem(null), null);
  assert.equal(normalizeApifyItem("nope"), null);
});

test("getApifyProfileUrlKey normalizes the profile URL for run matching", () => {
  const profile = normalizeApifyItem(APIFY_ITEM);
  assert.ok(profile);
  const key = getApifyProfileUrlKey(profile);
  assert.ok(key);
  // Trailing slash + scheme/host casing are normalized away.
  assert.match(key, /linkedin\.com\/in\/jane-doe$/);
});
