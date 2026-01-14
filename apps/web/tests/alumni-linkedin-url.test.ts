import test from "node:test";
import assert from "node:assert/strict";
import {
  linkedInProfileUrlSchema,
  normalizeLinkedInProfileUrl,
  optionalLinkedInProfileUrlSchema,
} from "@/lib/alumni/linkedin-url";
import { newAlumniSchema } from "@/lib/schemas/member";

test("normalizeLinkedInProfileUrl upgrades protocol, normalizes hostname, and strips trailing slash", () => {
  const result = normalizeLinkedInProfileUrl("http://linkedin.com/in/jane-doe/");
  assert.equal(result, "https://www.linkedin.com/in/jane-doe");
});

test("linkedInProfileUrlSchema accepts a normalized LinkedIn profile URL", () => {
  const result = linkedInProfileUrlSchema.safeParse("https://www.linkedin.com/in/jane-doe");
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data, "https://www.linkedin.com/in/jane-doe");
  }
});

test("linkedInProfileUrlSchema normalizes compatible LinkedIn inputs", () => {
  const result = linkedInProfileUrlSchema.safeParse("http://linkedin.com/in/jane-doe/");
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data, "https://www.linkedin.com/in/jane-doe");
  }
});

test("linkedInProfileUrlSchema rejects non-profile LinkedIn URLs", () => {
  const result = linkedInProfileUrlSchema.safeParse("https://www.linkedin.com/company/openai");
  assert.equal(result.success, false);
});

test("linkedInProfileUrlSchema rejects non-LinkedIn URLs", () => {
  const result = linkedInProfileUrlSchema.safeParse("https://twitter.com/jane");
  assert.equal(result.success, false);
});

test("optionalLinkedInProfileUrlSchema allows empty strings", () => {
  const result = optionalLinkedInProfileUrlSchema.safeParse("");
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data, "");
  }
});

test("newAlumniSchema normalizes linkedin_url through the shared LinkedIn profile validator", () => {
  const result = newAlumniSchema.safeParse({
    first_name: "Jane",
    last_name: "Smith",
    email: "jane@example.com",
    graduation_year: "2020",
    major: "",
    job_title: "",
    photo_url: "",
    notes: "",
    linkedin_url: "http://linkedin.com/in/jane-smith/",
    phone_number: "",
    industry: "",
    current_company: "",
    current_city: "",
    position_title: "",
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.linkedin_url, "https://www.linkedin.com/in/jane-smith");
  }
});

test("newAlumniSchema rejects non-LinkedIn URLs for linkedin_url", () => {
  const result = newAlumniSchema.safeParse({
    first_name: "Jane",
    last_name: "Smith",
    email: "jane@example.com",
    graduation_year: "2020",
    major: "",
    job_title: "",
    photo_url: "",
    notes: "",
    linkedin_url: "https://example.com/profile/jane",
    phone_number: "",
    industry: "",
    current_company: "",
    current_city: "",
    position_title: "",
  });

  assert.equal(result.success, false);
});
