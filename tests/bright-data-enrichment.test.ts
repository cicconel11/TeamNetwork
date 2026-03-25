import test from "node:test";
import assert from "node:assert/strict";

const { mapBrightDataToFields, isBrightDataConfigured } = await import(
  "@/lib/linkedin/bright-data"
);

test("mapBrightDataToFields extracts current job and school", () => {
  const result = mapBrightDataToFields({
    id: "john-doe-123",
    name: "John Doe",
    position: "Senior Engineer at Acme",
    about: "Building things that matter",
    city: "San Francisco, California, United States",
    country_code: "US",
    location: "San Francisco, CA",
    current_company_name: "Acme Corp",
    current_company: {
      name: "Acme Corp",
      title: "Senior Engineer",
      link: null,
      company_id: null,
    },
    avatar: null,
    url: "https://linkedin.com/in/john-doe-123",
    input_url: "https://linkedin.com/in/john-doe-123",
    followers: 500,
    connections: 300,
    experience: [
      {
        title: "Senior Engineer",
        company: "Acme Corp",
        description: "Building scalable systems",
        description_html: null,
        location: "San Francisco, CA",
        start_date: "2024-03",
        end_date: null,
        duration: "1 year",
        duration_short: "1 yr",
        url: null,
        company_logo_url: null,
        company_id: null,
      },
      {
        title: "Engineer",
        company: "OldCo",
        description: null,
        description_html: null,
        location: null,
        start_date: "2020-01",
        end_date: "2024-02",
        duration: "4 years",
        duration_short: "4 yrs",
        url: null,
        company_logo_url: null,
        company_id: null,
      },
    ],
    education: [
      {
        title: "State University",
        degree: "BS",
        field: "Computer Science",
        start_year: "2016",
        end_year: "2020",
        description: null,
        description_html: null,
        url: null,
        institute_logo_url: null,
      },
    ],
    recommendations_count: null,
    timestamp: null,
  });

  assert.equal(result.job_title, "Senior Engineer");
  assert.equal(result.current_company, "Acme Corp");
  assert.equal(result.current_city, "San Francisco, California, United States");
  assert.equal(result.school, "State University");
  assert.equal(result.major, "Computer Science");
  assert.equal(result.position_title, "Senior Engineer");
  assert.equal(result.headline, "Senior Engineer at Acme");
  assert.equal(result.summary, "Building things that matter");
  assert.equal(result.industry, null);
  assert.equal(result.work_history.length, 2);
  assert.equal(result.education_history.length, 1);
});

test("mapBrightDataToFields falls back to position when no experiences", () => {
  const result = mapBrightDataToFields({
    id: null,
    name: "Jane Doe",
    position: "Freelance Consultant",
    about: null,
    city: null,
    country_code: null,
    location: null,
    current_company_name: null,
    current_company: null,
    avatar: null,
    url: null,
    input_url: null,
    followers: null,
    connections: null,
    experience: [],
    education: [],
    recommendations_count: null,
    timestamp: null,
  });

  assert.equal(result.job_title, "Freelance Consultant");
  assert.equal(result.current_company, null);
  assert.equal(result.current_city, null);
  assert.equal(result.school, null);
  assert.equal(result.major, null);
  assert.equal(result.headline, "Freelance Consultant");
  assert.equal(result.summary, null);
  assert.deepEqual(result.work_history, []);
  assert.deepEqual(result.education_history, []);
});

test("mapBrightDataToFields uses first experience when all have end dates", () => {
  const result = mapBrightDataToFields({
    id: null,
    name: null,
    position: null,
    about: null,
    city: "Austin",
    country_code: null,
    location: "Austin, TX",
    current_company_name: null,
    current_company: null,
    avatar: null,
    url: null,
    input_url: null,
    followers: null,
    connections: null,
    experience: [
      {
        title: "Consultant",
        company: "MostRecent Inc",
        description: null,
        description_html: null,
        location: null,
        start_date: "2023-01",
        end_date: "2023-12",
        duration: null,
        duration_short: null,
        url: null,
        company_logo_url: null,
        company_id: null,
      },
    ],
    education: [],
    recommendations_count: null,
    timestamp: null,
  });

  assert.equal(result.job_title, "Consultant");
  assert.equal(result.current_company, "MostRecent Inc");
  assert.equal(result.current_city, "Austin");
});

test("mapBrightDataToFields prefers current_company object over current_company_name", () => {
  const result = mapBrightDataToFields({
    id: null,
    name: null,
    position: null,
    about: null,
    city: null,
    country_code: null,
    location: null,
    current_company_name: "Fallback Name",
    current_company: {
      name: "Primary Name",
      title: "CTO",
      link: null,
      company_id: null,
    },
    avatar: null,
    url: null,
    input_url: null,
    followers: null,
    connections: null,
    experience: [],
    education: [],
    recommendations_count: null,
    timestamp: null,
  });

  assert.equal(result.current_company, "Primary Name");
});

test("isBrightDataConfigured returns false when env var is missing", () => {
  const original = process.env.BRIGHT_DATA_API_KEY;
  delete process.env.BRIGHT_DATA_API_KEY;
  assert.equal(isBrightDataConfigured(), false);
  if (original) process.env.BRIGHT_DATA_API_KEY = original;
});

test("isBrightDataConfigured returns true when env var is set", () => {
  const original = process.env.BRIGHT_DATA_API_KEY;
  process.env.BRIGHT_DATA_API_KEY = "test-key";
  assert.equal(isBrightDataConfigured(), true);
  if (original) {
    process.env.BRIGHT_DATA_API_KEY = original;
  } else {
    delete process.env.BRIGHT_DATA_API_KEY;
  }
});
