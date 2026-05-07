import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeBioInputHash,
  extractExpertiseFromProfile,
  extractTopicsFromProfile,
  generateMentorBio,
  type BioGenerationInput,
} from "@/lib/mentorship/bio-generator";

function makeInput(overrides: Partial<BioGenerationInput> = {}): BioGenerationInput {
  return {
    name: "Jordan Smith",
    jobTitle: null,
    currentCompany: null,
    industry: null,
    roleFamily: null,
    graduationYear: 2018,
    linkedinSummary: null,
    linkedinHeadline: null,
    customAttributes: null,
    orgName: "TeamMeet U",
    ...overrides,
  };
}

describe("computeBioInputHash", () => {
  it("is stable for equivalent inputs", () => {
    const input = makeInput({
      jobTitle: "Product Manager",
      currentCompany: "Spotify",
      industry: "Technology",
      linkedinSummary: "Builds consumer products.",
    });

    assert.equal(computeBioInputHash(input), computeBioInputHash(input));
  });

  it("changes when input data changes", () => {
    const left = makeInput({ jobTitle: "Product Manager" });
    const right = makeInput({ jobTitle: "Software Engineer" });

    assert.notEqual(computeBioInputHash(left), computeBioInputHash(right));
  });
});

describe("profile extraction", () => {
  it("derives topics from industry, role family, and custom attributes", () => {
    const topics = extractTopicsFromProfile({
      jobTitle: "Software Engineer",
      currentCompany: "Stripe",
      industry: "Technology",
      customAttributes: {
        sport: "lacrosse",
        major: "computer science",
      },
    });

    assert.ok(topics.includes("technology"));
    assert.ok(topics.includes("lacrosse"));
    assert.ok(topics.includes("computer science"));
  });

  it("derives expertise areas from job title and industry", () => {
    const expertise = extractExpertiseFromProfile({
      jobTitle: "Software Engineer",
      currentCompany: "Stripe",
      industry: "Technology",
    });

    assert.ok(expertise.includes("Software Engineer"));
    assert.ok(expertise.includes("Technology"));
  });
});

describe("generateMentorBio", () => {
  it("falls back to the template path when there is not enough data for AI generation", async () => {
    const result = await generateMentorBio(
      makeInput({
        jobTitle: null,
        currentCompany: null,
        industry: null,
        customAttributes: { sport: "Lacrosse" },
      })
    );

    assert.equal(result.model, "template");
    assert.match(result.bio, /former Lacrosse athlete/i);
  });
});
