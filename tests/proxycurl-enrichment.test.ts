import test from "node:test";
import assert from "node:assert/strict";

const { mapEnrichmentToFields, isProxycurlConfigured } = await import(
  "@/lib/linkedin/proxycurl"
);

test("mapEnrichmentToFields extracts current job and school", () => {
  const result = mapEnrichmentToFields({
    occupation: "Software Engineer at Acme",
    headline: "Building things",
    summary: null,
    city: "San Francisco",
    state: "California",
    country: "US",
    experiences: [
      {
        starts_at: { day: 1, month: 3, year: 2024 },
        ends_at: null,
        company: "Acme Corp",
        company_linkedin_profile_url: null,
        title: "Senior Engineer",
        description: null,
        location: "San Francisco, CA",
      },
      {
        starts_at: { day: 1, month: 1, year: 2020 },
        ends_at: { day: 28, month: 2, year: 2024 },
        company: "OldCo",
        company_linkedin_profile_url: null,
        title: "Engineer",
        description: null,
        location: null,
      },
    ],
    education: [
      {
        starts_at: { day: 1, month: 9, year: 2016 },
        ends_at: { day: 1, month: 6, year: 2020 },
        school: "State University",
        school_linkedin_profile_url: null,
        degree_name: "BS",
        field_of_study: "Computer Science",
      },
    ],
  });

  assert.equal(result.job_title, "Senior Engineer");
  assert.equal(result.current_company, "Acme Corp");
  assert.equal(result.current_city, "San Francisco, California");
  assert.equal(result.school, "State University");
  assert.equal(result.major, "Computer Science");
  assert.equal(result.position_title, "Senior Engineer");
  assert.equal(result.industry, null);
});

test("mapEnrichmentToFields falls back to occupation when no experiences", () => {
  const result = mapEnrichmentToFields({
    occupation: "Freelance Consultant",
    headline: null,
    summary: null,
    city: null,
    state: null,
    country: null,
    experiences: [],
    education: [],
  });

  assert.equal(result.job_title, "Freelance Consultant");
  assert.equal(result.current_company, null);
  assert.equal(result.current_city, null);
  assert.equal(result.school, null);
  assert.equal(result.major, null);
});

test("mapEnrichmentToFields uses first experience when all have end dates", () => {
  const result = mapEnrichmentToFields({
    occupation: null,
    headline: null,
    summary: null,
    city: "Austin",
    state: null,
    country: null,
    experiences: [
      {
        starts_at: { day: 1, month: 1, year: 2023 },
        ends_at: { day: 1, month: 12, year: 2023 },
        company: "MostRecent Inc",
        company_linkedin_profile_url: null,
        title: "Consultant",
        description: null,
        location: null,
      },
    ],
    education: [],
  });

  assert.equal(result.job_title, "Consultant");
  assert.equal(result.current_company, "MostRecent Inc");
  assert.equal(result.current_city, "Austin");
});

test("isProxycurlConfigured returns false when env var is missing", () => {
  const original = process.env.PROXYCURL_API_KEY;
  delete process.env.PROXYCURL_API_KEY;
  assert.equal(isProxycurlConfigured(), false);
  if (original) process.env.PROXYCURL_API_KEY = original;
});

test("isProxycurlConfigured returns true when env var is set", () => {
  const original = process.env.PROXYCURL_API_KEY;
  process.env.PROXYCURL_API_KEY = "test-key";
  assert.equal(isProxycurlConfigured(), true);
  if (original) {
    process.env.PROXYCURL_API_KEY = original;
  } else {
    delete process.env.PROXYCURL_API_KEY;
  }
});
