import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeBioInputHash,
  extractExpertiseFromProfile,
  extractTopicsFromProfile,
  generateMentorBio,
  verifyBioGrounding,
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
    chosenExpertiseAreas: null,
    chosenTopics: null,
    chosenSports: null,
    chosenPositions: null,
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

  it("changes when chosen topics change (triggers regeneration)", () => {
    const before = makeInput({
      jobTitle: "Product Manager",
      currentCompany: "Spotify",
      chosenTopics: ["careers"],
    });
    const after = makeInput({
      jobTitle: "Product Manager",
      currentCompany: "Spotify",
      chosenTopics: ["careers", "leadership"],
    });

    assert.notEqual(computeBioInputHash(before), computeBioInputHash(after));
  });

  it("is idempotent for identical chosen-field inputs", () => {
    const input = makeInput({
      jobTitle: "Product Manager",
      currentCompany: "Spotify",
      chosenExpertiseAreas: ["product strategy"],
      chosenTopics: ["careers"],
      chosenSports: ["lacrosse"],
      chosenPositions: ["midfielder"],
    });

    assert.equal(computeBioInputHash(input), computeBioInputHash(input));
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

  it("folds the mentor's chosen topics, sports, and positions into derived topics", () => {
    const topics = extractTopicsFromProfile({
      jobTitle: "Software Engineer",
      currentCompany: "Stripe",
      industry: "Technology",
      customAttributes: null,
      chosenTopics: ["interview prep"],
      chosenSports: ["Rowing"],
      chosenPositions: ["Coxswain"],
    });

    assert.ok(topics.includes("interview prep"));
    assert.ok(topics.includes("rowing"));
    assert.ok(topics.includes("coxswain"));
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

  it("appends the mentor's chosen expertise areas without duplicating derived ones", () => {
    const expertise = extractExpertiseFromProfile({
      jobTitle: "Software Engineer",
      currentCompany: "Stripe",
      industry: "Technology",
      chosenExpertiseAreas: ["Distributed Systems", "software engineer"],
    });

    assert.ok(expertise.includes("Distributed Systems"));
    // "software engineer" duplicates the derived job title (case-insensitive).
    const lowerCount = expertise.filter((a) => a.toLowerCase() === "software engineer").length;
    assert.equal(lowerCount, 1);
  });
});

describe("verifyBioGrounding", () => {
  it("rejects a bio that invents a company not in the corpus", () => {
    const input = makeInput({
      jobTitle: "Product Manager",
      currentCompany: "Spotify",
    });
    // "Netflix" appears nowhere in the input.
    assert.equal(
      verifyBioGrounding("Product Manager at Netflix.", input),
      false
    );
  });

  it("rejects a bio asserting the wrong graduation year", () => {
    const input = makeInput({
      jobTitle: "Analyst",
      currentCompany: "EY",
      graduationYear: 2018,
    });
    assert.equal(
      verifyBioGrounding("Analyst at EY since graduating in 2007.", input),
      false
    );
  });

  it("accepts a faithful bio grounded entirely in the corpus", () => {
    const input = makeInput({
      jobTitle: "Product Manager",
      currentCompany: "Spotify",
      graduationYear: 2018,
    });
    assert.equal(
      verifyBioGrounding("Product Manager at Spotify since 2018.", input),
      true
    );
  });

  it("does not false-reject a clean template bio via stopwords", () => {
    const input = makeInput({
      jobTitle: "Consultant",
      currentCompany: "EY",
      industry: "Consulting",
      graduationYear: 2014,
      customAttributes: { sport: "Soccer" },
    });
    // Mirrors the template's connective vocabulary: Former, Mentors, Available.
    const templateBio =
      "Former Soccer athlete, now Consultant at EY. Available to mentor. Mentors on Consulting careers.";
    assert.equal(verifyBioGrounding(templateBio, input), true);
  });

  it("grounds proper nouns that come from custom attribute values", () => {
    const input = makeInput({
      jobTitle: "Coach",
      currentCompany: "Nike",
      customAttributes: { sport: "Basketball", position: "Point Guard" },
    });
    assert.equal(
      verifyBioGrounding("Former Basketball Point Guard, now Coach at Nike.", input),
      true
    );
  });

  it("grounds proper nouns that come from chosen sports/positions", () => {
    const input = makeInput({
      jobTitle: "Engineer",
      currentCompany: "Stripe",
      chosenSports: ["Crew"],
      chosenPositions: ["Stroke"],
    });
    assert.equal(
      verifyBioGrounding("Former Crew Stroke, now Engineer at Stripe.", input),
      true
    );
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
