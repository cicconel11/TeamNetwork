import { strict as assert } from "assert";
import { test } from "node:test";
import { formatPersonHeadline } from "@/components/shared/formatPersonHeadline";

test("returns null when no primary field is set", () => {
  assert.equal(formatPersonHeadline({}), null);
  assert.equal(formatPersonHeadline({ current_company: "Acme" }), null);
  assert.equal(formatPersonHeadline({ headline: "", role: null }), null);
  assert.equal(formatPersonHeadline({ headline: "   ", role: "" }), null);
});

test("alumni precedence: headline beats position_title and job_title", () => {
  assert.equal(
    formatPersonHeadline({
      headline: "Founding Engineer",
      position_title: "Senior Eng",
      job_title: "Engineer",
      current_company: "Acme",
    }),
    "Founding Engineer at Acme",
  );
});

test("alumni precedence: position_title beats job_title when no headline", () => {
  assert.equal(
    formatPersonHeadline({
      position_title: "Senior Eng",
      job_title: "Engineer",
      current_company: "Acme",
    }),
    "Senior Eng at Acme",
  );
});

test("alumni precedence: job_title used when nothing else present", () => {
  assert.equal(
    formatPersonHeadline({ job_title: "Engineer", current_company: "Acme" }),
    "Engineer at Acme",
  );
});

test("members shape: role used when no alumni fields present", () => {
  assert.equal(
    formatPersonHeadline({ role: "Captain", current_company: "Acme" }),
    "Captain at Acme",
  );
});

test("alumni headline beats role even though role is later in precedence", () => {
  // Mixed input: headline still wins over role
  assert.equal(
    formatPersonHeadline({ headline: "Founder", role: "Captain" }),
    "Founder",
  );
});

test("role precedence sits between headline and position_title", () => {
  // Members callers don't pass position_title, but the helper must still
  // honor headline > role > position_title > job_title.
  assert.equal(
    formatPersonHeadline({ role: "Captain", position_title: "Senior Eng" }),
    "Captain",
  );
});

test("omits ` at <company>` when current_company is empty/null", () => {
  assert.equal(formatPersonHeadline({ role: "Captain" }), "Captain");
  assert.equal(formatPersonHeadline({ role: "Captain", current_company: null }), "Captain");
  assert.equal(formatPersonHeadline({ role: "Captain", current_company: "" }), "Captain");
  assert.equal(formatPersonHeadline({ role: "Captain", current_company: "   " }), "Captain");
});

test("appends ` at <company>` when company is non-empty", () => {
  assert.equal(
    formatPersonHeadline({ headline: "Founder", current_company: "Acme" }),
    "Founder at Acme",
  );
});
