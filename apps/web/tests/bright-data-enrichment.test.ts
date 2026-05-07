import test from "node:test";
import assert from "node:assert/strict";

const { mapBrightDataToFields, isBrightDataConfigured } = await import(
  "@/lib/linkedin/bright-data"
);

test("mapBrightDataToFields extracts current job and school from real API shape", () => {
  // Matches actual Bright Data API response structure
  const result = mapBrightDataToFields({
    name: "Bill Gates",
    city: "Seattle, Washington, United States",
    position: "Chair, Gates Foundation and Founder, Breakthrough Energy",
    about: "Chair of the Gates Foundation. Founder of Breakthrough Energy.",
    current_company: "Gates Foundation",
    current_company_name: "Gates Foundation",
    experience: [
      {
        title: "Co-chair",
        company: "Gates Foundation",
        company_id: "gates-foundation",
        location: null,
        start_date: "2000",
        end_date: "Present", // Bright Data uses "Present" not null
        description_html: null,
        url: null,
        company_logo_url: null,
      },
      {
        title: "Co-founder",
        company: "Microsoft",
        company_id: "microsoft",
        location: null,
        start_date: "1975",
        end_date: "Present",
        description_html: null,
        url: null,
        company_logo_url: null,
      },
    ],
    education: [
      {
        title: "Harvard University", // school name is in "title", not "school"
        degree: null,
        field_of_study: null,
        url: null,
        start_year: "1973",
        end_year: "1975",
        description: null,
        description_html: null,
        institute_logo_url: null,
      },
    ],
  });

  assert.equal(result.job_title, "Co-chair"); // first "Present" experience
  assert.equal(result.current_company, "Gates Foundation");
  assert.equal(result.current_city, "Seattle, Washington, United States");
  assert.equal(result.school, "Harvard University"); // from education[0].title
  assert.equal(result.major, null); // no degree or field_of_study for Bill Gates
  assert.equal(result.position_title, "Co-chair");
});

test("mapBrightDataToFields handles education with degree and field_of_study", () => {
  const result = mapBrightDataToFields({
    name: "Jane Doe",
    city: "New York",
    position: "Software Engineer at Acme",
    about: null,
    current_company: null,
    current_company_name: "Acme Corp",
    experience: [
      {
        title: "Software Engineer",
        company: "Acme Corp",
        company_id: null,
        location: "New York, NY",
        start_date: "2022-01",
        end_date: "Present",
        description_html: null,
        url: null,
        company_logo_url: null,
      },
    ],
    education: [
      {
        title: "MIT",
        degree: "BS",
        field_of_study: "Computer Science",
        url: null,
        start_year: "2018",
        end_year: "2022",
        description: null,
        description_html: null,
        institute_logo_url: null,
      },
    ],
  });

  assert.equal(result.job_title, "Software Engineer");
  assert.equal(result.current_company, "Acme Corp");
  assert.equal(result.school, "MIT");
  assert.equal(result.major, "BS"); // degree takes precedence over field_of_study
});

test("mapBrightDataToFields falls back when no experiences", () => {
  const result = mapBrightDataToFields({
    name: "Jane Doe",
    city: null,
    position: null,
    about: null,
    current_company: null,
    current_company_name: null,
    experience: [],
    education: [],
  });

  assert.equal(result.job_title, null);
  assert.equal(result.current_company, null);
  assert.equal(result.school, null);
  assert.equal(result.major, null);
});

test("mapBrightDataToFields uses first experience when all have past end dates", () => {
  const result = mapBrightDataToFields({
    name: null,
    city: "Austin",
    position: null,
    about: null,
    current_company: null,
    current_company_name: null,
    experience: [
      {
        title: "Consultant",
        company: "MostRecent Inc",
        company_id: null,
        location: null,
        start_date: "2023-01",
        end_date: "2023-12",
        description_html: null,
        url: null,
        company_logo_url: null,
      },
    ],
    education: [],
  });

  assert.equal(result.job_title, "Consultant");
  assert.equal(result.current_company, "MostRecent Inc");
  assert.equal(result.current_city, "Austin");
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
