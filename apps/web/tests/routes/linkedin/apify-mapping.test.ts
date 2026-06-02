import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeApifyItem,
  mapApifyToFields,
  getApifyProfileUrlKeys,
  fetchApimaestroEducationDates,
  mergeEducationYears,
} from "@/lib/linkedin/apify";

// Mirrors the REAL dev_fusion/linkedin-profile-scraper output shape (verified
// against a live run): per-entry `logo`, `jobLocation`/`jobStartedOn`/
// `jobEndedOn`/`jobDescription` on experiences; `title`/`subtitle`/`period`/
// `logo` on educations; `skills` as `[{title}]`; `licenseAndCertificates` with
// title/subtitle/caption/logo.
const APIFY_ITEM = {
  linkedinUrl: "https://www.linkedin.com/in/jane-doe/",
  fullName: "Jane Doe",
  firstName: "Jane",
  lastName: "Doe",
  headline: "Staff Engineer at Acme",
  about: "Builds reliable systems.",
  companyIndustry: "Software Development",
  companyName: "Acme",
  addressWithoutCountry: "San Francisco, California",
  profilePicHighQuality: "https://media.licdn.com/photo/jane.jpg",
  experiences: [
    {
      title: "Staff Engineer",
      companyName: "Acme",
      logo: "https://media.licdn.com/company/acme.png",
      jobLocation: "San Francisco",
      jobStartedOn: "2022",
      jobEndedOn: null,
      jobStillWorking: true,
      jobDescription: "<p>Leads platform work.</p>",
    },
    {
      title: "Senior Engineer",
      companyName: "Globex",
      logo: "https://media.licdn.com/company/globex.png",
      jobStartedOn: "2018",
      jobEndedOn: "2022",
    },
  ],
  educations: [
    {
      title: "MIT",
      logo: "https://media.licdn.com/school/mit.png",
      subtitle: "BSc, Computer Science, Minor in Math",
      period: { startedOn: "2014", endedOn: "2018" },
      description: "Dean's list.",
    },
  ],
  skills: [{ title: "TypeScript" }, { title: "Distributed Systems" }, { name: "Postgres" }],
  licenseAndCertificates: [
    {
      title: "AWS Solutions Architect",
      subtitle: "Amazon Web Services",
      caption: "Issued Jan 2021",
      logo: "https://media.licdn.com/cert/aws.png",
    },
  ],
  languages: [{ title: "English" }, { title: "Spanish" }],
};

test("normalizeApifyItem maps the real dev_fusion payload into the neutral profile shape", () => {
  const profile = normalizeApifyItem(APIFY_ITEM);
  assert.ok(profile);
  assert.equal(profile.name, "Jane Doe");
  assert.equal(profile.headline, "Staff Engineer at Acme");
  assert.equal(profile.summary, "Builds reliable systems.");
  assert.equal(profile.industry, "Software Development");
  assert.equal(profile.current_company, "Acme");
  assert.equal(profile.city, "San Francisco, California");
  assert.equal(profile.photo_url, "https://media.licdn.com/photo/jane.jpg");

  // Experience: company logo, location, dates, and sanitized description.
  assert.equal(profile.experience.length, 2);
  const [current] = profile.experience;
  assert.equal(current.title, "Staff Engineer");
  assert.equal(current.company, "Acme");
  assert.equal(current.company_logo_url, "https://media.licdn.com/company/acme.png");
  assert.equal(current.location, "San Francisco");
  assert.equal(current.start_date, "2022");
  assert.equal(current.end_date, null);
  assert.equal(current.description_html, "Leads platform work.");

  // Education: school name in title, degree from subtitle, years from period, logo.
  assert.equal(profile.education.length, 1);
  const [edu] = profile.education;
  assert.equal(edu.title, "MIT");
  assert.equal(edu.institute_logo_url, "https://media.licdn.com/school/mit.png");
  assert.equal(edu.degree, "BSc, Computer Science, Minor in Math");
  assert.equal(edu.start_year, "2014");
  assert.equal(edu.end_year, "2018");
  assert.equal(edu.description, "Dean's list.");

  assert.deepEqual(profile.skills, ["TypeScript", "Distributed Systems", "Postgres"]);
  assert.deepEqual(profile.certifications, [
    {
      name: "AWS Solutions Architect",
      authority: "Amazon Web Services",
      issued_on: "Issued Jan 2021",
      logo_url: "https://media.licdn.com/cert/aws.png",
    },
  ]);
  assert.deepEqual(profile.languages, ["English", "Spanish"]);
});

test("mapApifyToFields derives current role + school detail from the profile", () => {
  const profile = normalizeApifyItem(APIFY_ITEM);
  assert.ok(profile);
  const fields = mapApifyToFields(profile);

  assert.equal(fields.job_title, "Staff Engineer");
  assert.equal(fields.position_title, "Staff Engineer");
  assert.equal(fields.current_company, "Acme");
  assert.equal(fields.industry, "Software Development");
  assert.equal(fields.current_city, "San Francisco, California");
  // School comes from the education `title`, major from the subtitle line.
  assert.equal(fields.school, "MIT");
  assert.equal(fields.major, "BSc, Computer Science, Minor in Math");
  assert.equal(fields.photo_url, "https://media.licdn.com/photo/jane.jpg");
  assert.equal(fields.work_history?.length, 2);
  assert.equal(fields.work_history?.[0]?.company_logo_url, "https://media.licdn.com/company/acme.png");
  assert.equal(fields.education_history?.length, 1);
  assert.equal(fields.education_history?.[0]?.institute_logo_url, "https://media.licdn.com/school/mit.png");
  assert.deepEqual(fields.skills, ["TypeScript", "Distributed Systems", "Postgres"]);
  assert.deepEqual(fields.languages, ["English", "Spanish"]);
  assert.equal(fields.certifications?.[0]?.name, "AWS Solutions Architect");
});

test("normalizeApifyItem still maps generic actor field names (legacy fallback)", () => {
  // A different actor may use flat field names — the fallbacks must keep working.
  const profile = normalizeApifyItem({
    fullName: "Legacy Shape",
    headline: "Engineer",
    experiences: [
      {
        title: "Engineer",
        company: "Initech",
        location: "Austin",
        startDate: "2019",
        endDate: "Present",
        description: "Wrote code.",
      },
    ],
    educations: [
      { school: "State U", degree: "BS", fieldOfStudy: "EE", startYear: "2010", endYear: "2014" },
    ],
  });
  assert.ok(profile);
  assert.equal(profile.experience[0].company, "Initech");
  assert.equal(profile.experience[0].location, "Austin");
  assert.equal(profile.experience[0].start_date, "2019");
  assert.equal(profile.experience[0].end_date, "Present");
  assert.equal(profile.education[0].title, "State U");
  assert.equal(profile.education[0].degree, "BS");
  assert.equal(profile.education[0].field_of_study, "EE");
  assert.equal(profile.education[0].start_year, "2010");
});

test("normalizeEducation strips the actor's literal None tokens from the degree line", () => {
  const profile = normalizeApifyItem({
    fullName: "High Schooler",
    educations: [
      { title: "Fordham Prep", subtitle: "None, None" },
      { title: "State College", subtitle: "BS, None" },
    ],
  });
  assert.ok(profile);
  assert.equal(profile.education[0].degree, null);
  assert.equal(profile.education[1].degree, "BS");
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

// Mirrors the apimaestro/linkedin-profile-detail shape (verified live): a single
// dataset item with `education[]` carrying `{school, start_date:{year,month?},
// end_date:{year,month?}}`. We only consume the years.
const APIMAESTRO_ITEM = [
  {
    basic_info: { fullname: "Jane Doe" },
    education: [
      {
        school: "MIT",
        start_date: { year: 2014 },
        end_date: { year: 2018 },
      },
      {
        school: "Phillips Academy",
        start_date: { year: 2010, month: "Sep" },
        end_date: { year: 2014, month: "May" },
      },
    ],
  },
];

function stubFetch(payload: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

// The fetch helper guards on APIFY_API_TOKEN; provide a dummy for these tests
// and restore the original so other suites in the shared process are unaffected.
async function withApifyToken<T>(fn: () => Promise<T>): Promise<T> {
  const original = process.env.APIFY_API_TOKEN;
  process.env.APIFY_API_TOKEN = "test-token";
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.APIFY_API_TOKEN;
    else process.env.APIFY_API_TOKEN = original;
  }
}

test("fetchApimaestroEducationDates keys years by normalized school name", async () => {
  await withApifyToken(async () => {
    const dates = await fetchApimaestroEducationDates("https://www.linkedin.com/in/jane-doe/", {
      fetchFn: stubFetch(APIMAESTRO_ITEM),
    });
    assert.equal(dates.size, 2);
    assert.deepEqual(dates.get("mit"), { start_year: "2014", end_year: "2018" });
    assert.deepEqual(dates.get("phillips academy"), { start_year: "2010", end_year: "2014" });
  });
});

test("fetchApimaestroEducationDates returns empty map on a missing URL", async () => {
  await withApifyToken(async () => {
    const dates = await fetchApimaestroEducationDates(null, { fetchFn: stubFetch(APIMAESTRO_ITEM) });
    assert.equal(dates.size, 0);
  });
});

test("fetchApimaestroEducationDates is best-effort on a failed run", async () => {
  await withApifyToken(async () => {
    const failing = (async () => new Response("err", { status: 500 })) as unknown as typeof fetch;
    const dates = await fetchApimaestroEducationDates("https://www.linkedin.com/in/jane-doe/", {
      fetchFn: failing,
    });
    assert.equal(dates.size, 0);
  });
});

test("mergeEducationYears fills missing years by school name without overwriting", () => {
  // dev_fusion gives the school + degree + logo but null years (verified live).
  const profile = normalizeApifyItem({
    fullName: "Jane Doe",
    educations: [
      { title: "MIT", subtitle: "BSc, Computer Science", period: { startedOn: null, endedOn: null } },
      { title: "Phillips Academy", subtitle: "High School Diploma", period: { startedOn: "2009", endedOn: "2013" } },
    ],
  });
  assert.ok(profile);
  assert.equal(profile.education[0].start_year, null);
  assert.equal(profile.education[1].start_year, "2009");

  mergeEducationYears(
    profile,
    new Map([
      ["mit", { start_year: "2014", end_year: "2018" }],
      ["phillips academy", { start_year: "2010", end_year: "2014" }],
    ]),
  );

  // MIT had no years → filled from apimaestro.
  assert.equal(profile.education[0].start_year, "2014");
  assert.equal(profile.education[0].end_year, "2018");
  // Phillips already had dev_fusion years → left untouched.
  assert.equal(profile.education[1].start_year, "2009");
  assert.equal(profile.education[1].end_year, "2013");
});

test("getApifyProfileUrlKeys normalizes the profile URL for run matching", () => {
  const profile = normalizeApifyItem(APIFY_ITEM);
  assert.ok(profile);
  const keys = getApifyProfileUrlKeys(profile);
  // Trailing slash + scheme/host casing are normalized away.
  assert.ok(keys.some((k) => /linkedin\.com\/in\/jane-doe$/.test(k)));
});

test("getApifyProfileUrlKeys indexes both linkedinUrl and linkedinPublicUrl", () => {
  const profile = normalizeApifyItem({
    fullName: "Jane Doe",
    linkedinUrl: "https://www.linkedin.com/in/jane-doe?trk=public",
    linkedinPublicUrl: "https://www.linkedin.com/in/jane-doe-canonical",
  });
  assert.ok(profile);
  const keys = getApifyProfileUrlKeys(profile);
  assert.deepEqual(keys.sort(), [
    "https://www.linkedin.com/in/jane-doe",
    "https://www.linkedin.com/in/jane-doe-canonical",
  ]);
});
