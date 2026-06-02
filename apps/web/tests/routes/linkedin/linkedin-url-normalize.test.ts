import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLinkedInProfileUrl,
  isLinkedInProfileUrl,
} from "@/lib/alumni/linkedin-url";

/**
 * Regression coverage for the enrichment URL-matching key.
 *
 * Apify's dev_fusion actor echoes the profile URL back in `linkedinUrl`, and the
 * write-back matches a scraped profile to its alumni/user row purely by
 * `normalizeLinkedInProfileUrl(...)` on both sides. In production every failed
 * enrichment run carried error='no_matching_profile': a stored URL and the
 * actor echo that are the SAME profile but differ in shape (slug case, a
 * tracking query string, a fragment, or a locale subdomain) normalized to
 * different keys, so the scraped profile was dropped and the row failed.
 *
 * The normalizer must collapse those cosmetic differences to a single canonical
 * key while keeping genuinely different profiles distinct.
 */
describe("normalizeLinkedInProfileUrl — matching key equivalence", () => {
  const canonical = "https://www.linkedin.com/in/williamhgates";

  const equivalentInputs: Array<[string, string]> = [
    ["http vs https", "http://www.linkedin.com/in/williamhgates"],
    ["bare host (no www)", "https://linkedin.com/in/williamhgates"],
    ["trailing slash", "https://www.linkedin.com/in/williamhgates/"],
    ["uppercase host", "https://WWW.LINKEDIN.COM/in/williamhgates"],
    ["mixed-case slug", "https://www.linkedin.com/in/WilliamHGates"],
    [
      "tracking query string",
      "https://www.linkedin.com/in/williamhgates?originalSubdomain=us&trk=public_profile",
    ],
    ["fragment", "https://www.linkedin.com/in/williamhgates#experience"],
    ["locale subdomain", "https://de.linkedin.com/in/williamhgates"],
    [
      "everything at once",
      "http://DE.linkedin.com/in/WilliamHGates/?trk=abc#about",
    ],
  ];

  for (const [label, input] of equivalentInputs) {
    it(`treats ${label} as the canonical key`, () => {
      assert.equal(normalizeLinkedInProfileUrl(input), canonical);
    });
  }

  it("keeps genuinely different profiles distinct", () => {
    assert.notEqual(
      normalizeLinkedInProfileUrl("https://www.linkedin.com/in/williamhgates"),
      normalizeLinkedInProfileUrl("https://www.linkedin.com/in/satyanadella"),
    );
  });

  it("still accepts the canonicalized forms as valid profile URLs", () => {
    for (const [, input] of equivalentInputs) {
      assert.equal(
        isLinkedInProfileUrl(input),
        true,
        `expected ${input} to validate`,
      );
    }
  });

  it("returns the trimmed original when the value is not a URL", () => {
    assert.equal(normalizeLinkedInProfileUrl("  not a url  "), "not a url");
  });
});
