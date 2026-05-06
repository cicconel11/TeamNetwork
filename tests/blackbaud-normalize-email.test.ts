import test from "node:test";
import assert from "node:assert/strict";
import { normalizeConstituent } from "../src/lib/blackbaud/normalize";
import type {
  BlackbaudConstituent,
  BlackbaudEmail,
} from "../src/lib/blackbaud/types";

const baseConstituent: BlackbaudConstituent = {
  id: "1",
  first: "Jane",
  last: "Doe",
  class_of: "2010",
};

function buildEmails(address: string): BlackbaudEmail[] {
  return [
    {
      id: "e1",
      address,
      primary: true,
      inactive: false,
      do_not_email: false,
    } as unknown as BlackbaudEmail,
  ];
}

test("normalizeConstituent lowercases primary email", () => {
  const result = normalizeConstituent(
    baseConstituent,
    buildEmails("Jane.Doe@School.EDU"),
    [],
    [],
  );
  assert.equal(result.email, "jane.doe@school.edu");
});

test("normalizeConstituent trims surrounding whitespace before lowercasing", () => {
  const result = normalizeConstituent(
    baseConstituent,
    buildEmails("  Jane.Doe@School.EDU  "),
    [],
    [],
  );
  assert.equal(result.email, "jane.doe@school.edu");
});

test("normalizeConstituent returns null when no primary email", () => {
  const result = normalizeConstituent(baseConstituent, [], [], []);
  assert.equal(result.email, null);
});
