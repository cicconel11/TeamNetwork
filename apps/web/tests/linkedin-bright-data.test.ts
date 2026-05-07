import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  fetchBrightDataProfile,
  mapBrightDataToFields,
  isBrightDataConfigured,
  type BrightDataProfileResult,
} from "../src/lib/linkedin/bright-data";

describe("Bright Data LinkedIn client", () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.BRIGHT_DATA_API_KEY;
  });

  afterEach(() => {
    if (savedKey === undefined) {
      delete process.env.BRIGHT_DATA_API_KEY;
    } else {
      process.env.BRIGHT_DATA_API_KEY = savedKey;
    }
  });

  describe("isBrightDataConfigured", () => {
    it("returns true when API key is set", () => {
      process.env.BRIGHT_DATA_API_KEY = "test-key-123";
      assert.equal(isBrightDataConfigured(), true);
    });

    it("returns false when API key is missing", () => {
      delete process.env.BRIGHT_DATA_API_KEY;
      assert.equal(isBrightDataConfigured(), false);
    });

    it("returns false when API key is empty string", () => {
      process.env.BRIGHT_DATA_API_KEY = "";
      assert.equal(isBrightDataConfigured(), false);
    });

    it("returns false when API key is whitespace", () => {
      process.env.BRIGHT_DATA_API_KEY = "   ";
      assert.equal(isBrightDataConfigured(), false);
    });
  });

  describe("mapBrightDataToFields", () => {
    it("extracts current job from experience with no end_date", () => {
      const profile: BrightDataProfileResult = {
        name: "Jane Doe",
        first_name: "Jane",
        last_name: "Doe",
        city: "San Francisco",
        position: null,
        about: null,
        current_company: null,
        current_company_name: "Acme Corp",
        experience: [
          { title: "CEO", company: "Acme Corp", location: "SF", end_date: null },
          { title: "CTO", company: "Old Co", location: "NY", end_date: "2022-12" },
        ],
        education: [
          { title: "MIT", field_of_study: "Computer Science" },
        ],
      };

      const fields = mapBrightDataToFields(profile);

      assert.equal(fields.job_title, "CEO");
      assert.equal(fields.current_company, "Acme Corp");
      assert.equal(fields.current_city, "San Francisco");
      assert.equal(fields.school, "MIT");
      assert.equal(fields.major, "Computer Science");
      assert.equal(fields.position_title, "CEO");
      assert.equal(fields.industry, null);
    });

    it("falls back to first experience when none has null end_date", () => {
      const profile: BrightDataProfileResult = {
        name: "Bob",
        first_name: "Bob",
        last_name: null,
        city: null,
        position: null,
        about: null,
        current_company: null,
        current_company_name: null,
        experience: [
          { title: "Engineer", company: "OldCo", location: "LA", end_date: "2023" },
        ],
        education: [],
      };

      const fields = mapBrightDataToFields(profile);

      assert.equal(fields.job_title, "Engineer");
      assert.equal(fields.current_company, "OldCo");
      assert.equal(fields.current_city, "LA");
      assert.equal(fields.school, null);
      assert.equal(fields.major, null);
    });

    it("handles empty profile gracefully", () => {
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
        education: [],
      };

      const fields = mapBrightDataToFields(profile);

      assert.equal(fields.job_title, null);
      assert.equal(fields.current_company, null);
      assert.equal(fields.current_city, null);
      assert.equal(fields.school, null);
      assert.equal(fields.major, null);
      assert.equal(fields.position_title, null);
    });

    it("uses current_company_name over experience company", () => {
      const profile: BrightDataProfileResult = {
        name: null,
        first_name: null,
        last_name: null,
        city: null,
        position: null,
        about: null,
        current_company: null,
        current_company_name: "Top-Level Company",
        experience: [
          { title: "Dev", company: "Experience Co", location: null, end_date: null },
        ],
        education: [],
      };

      const fields = mapBrightDataToFields(profile);
      assert.equal(fields.current_company, "Top-Level Company");
    });

    it("handles non-array experience/education gracefully", () => {
      const profile = {
        name: null,
        first_name: null,
        last_name: null,
        city: null,
        position: null,
        current_company: null,
        current_company_name: null,
        experience: null as unknown as BrightDataProfileResult["experience"],
        education: "invalid" as unknown as BrightDataProfileResult["education"],
      };

      const fields = mapBrightDataToFields(profile);
      assert.equal(fields.job_title, null);
      assert.equal(fields.school, null);
    });

    it("uses documented current_company and position fields when experience is absent", () => {
      const profile: BrightDataProfileResult = {
        name: "Satya Nadella",
        first_name: "Satya",
        last_name: "Nadella",
        city: "Redmond, Washington, United States",
        position: "Chairman and CEO at Microsoft",
        about: null,
        current_company: "Microsoft",
        current_company_name: null,
        experience: [],
        education: [],
      };

      const fields = mapBrightDataToFields(profile);
      assert.equal(fields.job_title, "Chairman and CEO at Microsoft");
      assert.equal(fields.current_company, "Microsoft");
      assert.equal(fields.position_title, "Chairman and CEO at Microsoft");
    });
  });

  describe("fetchBrightDataProfile", () => {
    it("normalizes the documented Bright Data profile payload", async () => {
      process.env.BRIGHT_DATA_API_KEY = "test-key-123";
      const mockFetch = mock.fn(async () => {
        return new Response(JSON.stringify({
          name: "Satya Nadella",
          city: "Redmond, Washington, United States",
          position: "Chairman and CEO at Microsoft",
          current_company: { name: "Microsoft" },
          education: [{ school: "University of Chicago", field_of_study: null }],
        }), { status: 200 });
      });

      const result = await fetchBrightDataProfile(
        "https://www.linkedin.com/in/satyanadella",
        { fetchFn: mockFetch as unknown as typeof fetch },
      );

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.deepEqual(result.profile, {
        name: "Satya Nadella",
        first_name: null,
        last_name: null,
        city: "Redmond, Washington, United States",
        position: "Chairman and CEO at Microsoft",
        about: null,
        current_company: "Microsoft",
        current_company_name: null,
        experience: [
          {
            title: null,
            company: "Microsoft",
            company_id: null,
            location: null,
            start_date: null,
            end_date: null,
            description_html: null,
            url: null,
            company_logo_url: null,
          },
        ],
        education: [{ school: "University of Chicago", field_of_study: null, description_html: null }],
        educations_details: null,
        avatar: null,
      });
    });

    it("classifies non-200 responses as upstream errors", async () => {
      process.env.BRIGHT_DATA_API_KEY = "test-key-123";
      const mockFetch = mock.fn(async () => {
        return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
      });

      const result = await fetchBrightDataProfile(
        "https://www.linkedin.com/in/satyanadella",
        { fetchFn: mockFetch as unknown as typeof fetch },
      );

      assert.deepEqual(result, {
        ok: false,
        kind: "upstream_error",
        error: "Bright Data rejected the profile lookup.",
        upstreamStatus: 400,
      });
    });

    it("classifies provider 404 responses as account or endpoint availability failures", async () => {
      process.env.BRIGHT_DATA_API_KEY = "test-key-123";
      const mockFetch = mock.fn(async () => {
        return new Response("Not found", { status: 404 });
      });

      const result = await fetchBrightDataProfile(
        "https://www.linkedin.com/in/satyanadella",
        { fetchFn: mockFetch as unknown as typeof fetch },
      );

      assert.deepEqual(result, {
        ok: false,
        kind: "provider_unavailable",
        error: "Bright Data LinkedIn Profiles API is unavailable for the configured account.",
        upstreamStatus: 404,
      });
    });

    it("classifies malformed payloads instead of pretending no data was returned", async () => {
      process.env.BRIGHT_DATA_API_KEY = "test-key-123";
      const mockFetch = mock.fn(async () => {
        return new Response(JSON.stringify({ hello: "world" }), { status: 200 });
      });

      const result = await fetchBrightDataProfile(
        "https://www.linkedin.com/in/satyanadella",
        { fetchFn: mockFetch as unknown as typeof fetch },
      );

      assert.deepEqual(result, {
        ok: false,
        kind: "malformed_payload",
        error: "Bright Data returned an unexpected profile payload.",
      });
    });
  });
});
