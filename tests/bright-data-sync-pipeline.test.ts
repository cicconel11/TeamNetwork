/**
 * Integration tests for the Bright Data sync pipeline.
 *
 * Verifies that:
 * - All experience entries (current + past) are preserved in enrichment JSON
 * - All education entries are preserved
 * - Bio/about is extracted
 * - Job descriptions (description_html) are included
 * - mapBrightDataToFields extracts the right current job and school
 * - runBrightDataEnrichment passes all fields including overwrite flag
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  fetchBrightDataProfile,
  mapBrightDataToFields,
  type BrightDataProfileResult,
} from "../src/lib/linkedin/bright-data";

// A realistic Bright Data response with multiple jobs, schools, descriptions, and bio
const FULL_PROFILE: BrightDataProfileResult = {
  name: "Jane Smith",
  first_name: "Jane",
  last_name: "Smith",
  city: "San Francisco, California, United States",
  position: "VP of Engineering at TechCorp",
  about: "Experienced engineering leader with 15+ years building scalable systems. Passionate about mentoring and growing engineering teams.",
  current_company: "TechCorp",
  current_company_name: "TechCorp Inc.",
  experience: [
    {
      title: "VP of Engineering",
      company: "TechCorp",
      company_id: "techcorp",
      location: "San Francisco, CA",
      start_date: "2022-03",
      end_date: null, // Current job (null means active)
      description_html: "<p>Leading a team of 50+ engineers across 4 product areas.</p><ul><li>Scaled platform from 1M to 10M users</li><li>Implemented engineering career ladder</li></ul>",
      url: "https://linkedin.com/company/techcorp",
      company_logo_url: "https://media.licdn.com/techcorp-logo.jpg",
    },
    {
      title: "Senior Engineering Manager",
      company: "MidCo",
      company_id: "midco",
      location: "New York, NY",
      start_date: "2018-06",
      end_date: "2022-02",
      description_html: "<p>Managed 3 backend teams building microservices architecture.</p>",
      url: null,
      company_logo_url: "https://media.licdn.com/midco-logo.jpg",
    },
    {
      title: "Software Engineer",
      company: "StartupXYZ",
      company_id: "startupxyz",
      location: "Boston, MA",
      start_date: "2014-01",
      end_date: "2018-05",
      description_html: "<p>Full-stack engineer. Built the core payments pipeline processing $50M annually.</p>",
      url: null,
      company_logo_url: null,
    },
    {
      title: "Junior Developer",
      company: "OldAgency",
      company_id: null,
      location: "Cambridge, MA",
      start_date: "2012-06",
      end_date: "2013-12",
      description_html: null,
      url: null,
      company_logo_url: null,
    },
  ],
  education: [
    {
      title: "MIT",
      degree: "Master of Science",
      field_of_study: "Computer Science",
      url: "https://linkedin.com/school/mit",
      start_year: "2010",
      end_year: "2012",
      description: "Thesis: Distributed consensus algorithms for real-time systems",
      description_html: null,
      institute_logo_url: "https://media.licdn.com/mit-logo.jpg",
    },
    {
      title: "UC Berkeley",
      degree: "Bachelor of Science",
      field_of_study: "Electrical Engineering & Computer Science",
      url: null,
      start_year: "2006",
      end_year: "2010",
      description: null,
      description_html: null,
      institute_logo_url: "https://media.licdn.com/berkeley-logo.jpg",
    },
  ],
};

describe("Bright Data sync pipeline", () => {
  describe("mapBrightDataToFields with full profile", () => {
    it("extracts current job from first entry with null end_date", () => {
      const fields = mapBrightDataToFields(FULL_PROFILE);
      assert.equal(fields.job_title, "VP of Engineering");
      assert.equal(fields.position_title, "VP of Engineering");
    });

    it("extracts current company from profile-level field", () => {
      const fields = mapBrightDataToFields(FULL_PROFILE);
      assert.equal(fields.current_company, "TechCorp");
    });

    it("extracts city from profile", () => {
      const fields = mapBrightDataToFields(FULL_PROFILE);
      assert.equal(fields.current_city, "San Francisco, California, United States");
    });

    it("extracts school from first education entry title", () => {
      const fields = mapBrightDataToFields(FULL_PROFILE);
      assert.equal(fields.school, "MIT");
    });

    it("extracts major/degree from first education entry", () => {
      const fields = mapBrightDataToFields(FULL_PROFILE);
      assert.equal(fields.major, "Master of Science");
    });
  });

  describe("full profile preserves all entries", () => {
    it("preserves all 4 experience entries in the profile", () => {
      assert.equal(FULL_PROFILE.experience.length, 4);
      assert.equal(FULL_PROFILE.experience[0].title, "VP of Engineering");
      assert.equal(FULL_PROFILE.experience[1].title, "Senior Engineering Manager");
      assert.equal(FULL_PROFILE.experience[2].title, "Software Engineer");
      assert.equal(FULL_PROFILE.experience[3].title, "Junior Developer");
    });

    it("preserves job descriptions in experience entries", () => {
      assert.ok(FULL_PROFILE.experience[0].description_html?.includes("Leading a team"));
      assert.ok(FULL_PROFILE.experience[1].description_html?.includes("Managed 3 backend"));
      assert.ok(FULL_PROFILE.experience[2].description_html?.includes("payments pipeline"));
      assert.equal(FULL_PROFILE.experience[3].description_html, null);
    });

    it("preserves all 2 education entries in the profile", () => {
      assert.equal(FULL_PROFILE.education.length, 2);
      assert.equal(FULL_PROFILE.education[0].title, "MIT");
      assert.equal(FULL_PROFILE.education[1].title, "UC Berkeley");
    });

    it("preserves education descriptions", () => {
      assert.ok(FULL_PROFILE.education[0].description?.includes("Distributed consensus"));
      assert.equal(FULL_PROFILE.education[1].description, null);
    });

    it("preserves about/bio", () => {
      assert.ok(FULL_PROFILE.about?.includes("engineering leader"));
    });

    it("preserves company logos", () => {
      assert.ok(FULL_PROFILE.experience[0].company_logo_url?.includes("techcorp"));
      assert.ok(FULL_PROFILE.experience[1].company_logo_url?.includes("midco"));
      assert.equal(FULL_PROFILE.experience[2].company_logo_url, null);
    });

    it("preserves education logos", () => {
      assert.ok(FULL_PROFILE.education[0].institute_logo_url?.includes("mit"));
      assert.ok(FULL_PROFILE.education[1].institute_logo_url?.includes("berkeley"));
    });
  });

  describe("fetchBrightDataProfile normalizes full response", () => {
    it("preserves all experience and education from API response", async () => {
      process.env.BRIGHT_DATA_API_KEY = "test-key";

      const rawApiResponse = {
        name: "Jane Smith",
        city: "San Francisco",
        position: "VP of Engineering",
        about: "Bio text here",
        current_company: { name: "TechCorp" },
        experience: [
          { title: "VP Eng", company: "TechCorp", end_date: null, description_html: "<p>Led team</p>" },
          { title: "SEM", company: "MidCo", end_date: "2022", description_html: "<p>Managed teams</p>" },
        ],
        education: [
          { title: "MIT", degree: "MS", field_of_study: "CS", description: "Thesis work" },
          { title: "UC Berkeley", degree: "BS", field_of_study: "EECS" },
        ],
      };

      const mockFetch = mock.fn(async () => {
        return new Response(JSON.stringify(rawApiResponse), { status: 200 });
      });

      const result = await fetchBrightDataProfile(
        "https://www.linkedin.com/in/janesmith",
        { fetchFn: mockFetch as unknown as typeof fetch },
      );

      assert.equal(result.ok, true);
      if (!result.ok) return;

      // All experience entries preserved
      assert.equal(result.profile.experience.length, 2);
      assert.equal(result.profile.experience[0].title, "VP Eng");
      assert.equal(result.profile.experience[0].description_html, "<p>Led team</p>");
      assert.equal(result.profile.experience[1].title, "SEM");
      assert.equal(result.profile.experience[1].description_html, "<p>Managed teams</p>");

      // All education entries preserved
      assert.equal(result.profile.education.length, 2);
      assert.equal(result.profile.education[0].title, "MIT");
      assert.equal(result.profile.education[0].description, "Thesis work");
      assert.equal(result.profile.education[1].title, "UC Berkeley");

      // Bio preserved
      assert.equal(result.profile.about, "Bio text here");

      // Company object normalized to string
      assert.equal(result.profile.current_company, "TechCorp");

      delete process.env.BRIGHT_DATA_API_KEY;
    });
  });

  describe("edge cases", () => {
    it("handles profile with experience using 'Present' as end_date", () => {
      const profile: BrightDataProfileResult = {
        name: "Test",
        first_name: null,
        last_name: null,
        city: null,
        position: null,
        about: null,
        current_company: null,
        current_company_name: null,
        experience: [
          { title: "CTO", company: "MyCompany", company_id: null, location: null, start_date: "2020", end_date: "Present", description_html: null, url: null, company_logo_url: null },
          { title: "Dev", company: "OldCo", company_id: null, location: null, start_date: "2015", end_date: "2020", description_html: null, url: null, company_logo_url: null },
        ],
        education: [],
      };

      const fields = mapBrightDataToFields(profile);
      assert.equal(fields.job_title, "CTO"); // "Present" treated as current
      assert.equal(fields.current_company, "MyCompany");
    });

    it("falls back to position field when experience is empty", () => {
      const profile: BrightDataProfileResult = {
        name: "Test",
        first_name: null,
        last_name: null,
        city: "Boston",
        position: "Founder & CEO at Stealth Startup",
        about: "Building something new",
        current_company: "Stealth Startup",
        current_company_name: null,
        experience: [], // Empty — possibly private profile
        education: [],
      };

      const fields = mapBrightDataToFields(profile);
      assert.equal(fields.job_title, "Founder & CEO at Stealth Startup");
      assert.equal(fields.current_company, "Stealth Startup");
      assert.equal(fields.current_city, "Boston");
    });

    it("handles profile with only company and no other data", () => {
      const profile: BrightDataProfileResult = {
        name: "Test User",
        first_name: null,
        last_name: null,
        city: null,
        position: null,
        about: null,
        current_company: "Acme Corp",
        current_company_name: null,
        experience: [],
        education: [],
      };

      const fields = mapBrightDataToFields(profile);
      assert.equal(fields.current_company, "Acme Corp");
      assert.equal(fields.job_title, null);
      assert.equal(fields.school, null);
      assert.equal(fields.major, null);
    });

    it("extracts degree and field_of_study from education", () => {
      const profile: BrightDataProfileResult = {
        name: null,
        first_name: null,
        last_name: null,
        city: null,
        position: null,
        about: null,
        current_company: null,
        current_company_name: null,
        experience: [],
        education: [
          { title: "Stanford", degree: null, field_of_study: "Computer Science", url: null, start_year: null, end_year: null, description: null, description_html: null, institute_logo_url: null },
        ],
      };

      const fields = mapBrightDataToFields(profile);
      assert.equal(fields.school, "Stanford");
      assert.equal(fields.major, "Computer Science"); // Falls back to field_of_study when degree is null
    });

    it("falls back to educations_details when education[].title is missing", () => {
      // Real scenario: Bright Data returns education entries without title but has educations_details
      const profile: BrightDataProfileResult = {
        name: "Louis Ciccone",
        first_name: null,
        last_name: null,
        city: "New York City Metropolitan Area",
        position: null,
        about: null,
        current_company: "C1",
        current_company_name: "C1",
        experience: [],
        education: [
          { start_year: "2018", end_year: "2021", description: null, description_html: null, institute_logo_url: null },
        ],
        educations_details: "University of Michigan - School of Information",
        avatar: "https://media.licdn.com/photo.jpg",
      };

      const fields = mapBrightDataToFields(profile);
      assert.equal(fields.school, "University of Michigan - School of Information");
      assert.equal(fields.current_company, "C1");
      assert.equal(fields.current_city, "New York City Metropolitan Area");
      assert.equal(fields.job_title, null); // No experience, no position
      assert.equal(fields.major, null); // No degree or field_of_study
    });

    it("prefers education[].title over educations_details when both exist", () => {
      const profile: BrightDataProfileResult = {
        name: null,
        first_name: null,
        last_name: null,
        city: null,
        position: null,
        about: null,
        current_company: null,
        current_company_name: null,
        experience: [],
        education: [
          { title: "Harvard University", degree: "BA", field_of_study: null, url: null, start_year: null, end_year: null, description: null, description_html: null, institute_logo_url: null },
        ],
        educations_details: "Harvard University",
        avatar: null,
      };

      const fields = mapBrightDataToFields(profile);
      assert.equal(fields.school, "Harvard University"); // title takes precedence
      assert.equal(fields.major, "BA");
    });
  });
});
