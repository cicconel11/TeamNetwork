import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  computeProvenanceStrip,
  ENRICHMENT_PROVENANCE_FIELDS,
  buildAlumniWritePayload,
} from "../src/lib/alumni/mutations.ts";

const routeSource = await readFile(
  new URL(
    "../src/app/api/organizations/[organizationId]/alumni/[alumniId]/route.ts",
    import.meta.url
  ),
  "utf8"
);
const editPageSource = await readFile(
  new URL("../src/app/[orgSlug]/alumni/[alumniId]/edit/page.tsx", import.meta.url),
  "utf8"
);
const formSource = await readFile(
  new URL("../src/components/alumni/EditAlumniForm.tsx", import.meta.url),
  "utf8"
);

// ── Pure strip-computation helper (D11) ─────────────────────────────────────

/** A pre-update alumni row whose company + industry came from enrichment. */
function enrichedRow() {
  return {
    id: "a1",
    first_name: "Pat",
    job_title: "Engineer at Initech",
    position_title: null,
    current_company: "Initech",
    current_city: "Austin, TX",
    major: "Finance",
    industry: "Technology",
    photo_url: null,
  };
}

/** PATCH payload that round-trips the row unchanged. */
function identicalPayload() {
  return {
    job_title: "Engineer at Initech",
    position_title: null,
    current_company: "Initech",
    current_city: "Austin, TX",
    major: "Finance",
    industry: "Technology",
    photo_url: null,
  };
}

test("changed enriched field is stripped", () => {
  const payload = { ...identicalPayload(), current_company: "Globex" };
  const stripped = computeProvenanceStrip(enrichedRow(), payload, [
    "current_company",
    "industry",
  ]);
  assert.deepEqual(stripped, ["current_company"]);
});

test("untouched enriched field stays (only the changed key is stripped)", () => {
  const payload = { ...identicalPayload(), industry: "Healthcare" };
  const filled = ["current_company", "industry"];
  const stripped = computeProvenanceStrip(enrichedRow(), payload, filled);
  assert.deepEqual(stripped, ["industry"]);
  // The route keeps everything not stripped:
  const next = filled.filter((f) => !stripped.includes(f));
  assert.deepEqual(next, ["current_company"]);
});

test("identical round-trip strips nothing", () => {
  const stripped = computeProvenanceStrip(enrichedRow(), identicalPayload(), [
    "current_company",
    "industry",
    "current_city",
  ]);
  assert.deepEqual(stripped, []);
});

test("whitespace-only differences are NOT changes (trim-compare)", () => {
  const payload = { ...identicalPayload(), current_company: "  Initech  " };
  const stripped = computeProvenanceStrip(enrichedRow(), payload, ["current_company"]);
  assert.deepEqual(stripped, []);
});

test("null provenance list is a no-op", () => {
  const payload = { ...identicalPayload(), current_company: "Globex" };
  assert.deepEqual(computeProvenanceStrip(enrichedRow(), payload, null), []);
  assert.deepEqual(computeProvenanceStrip(enrichedRow(), payload, undefined), []);
});

test("empty provenance list is a no-op", () => {
  const payload = { ...identicalPayload(), current_company: "Globex" };
  assert.deepEqual(computeProvenanceStrip(enrichedRow(), payload, []), []);
});

test("changed field NOT in the provenance list is not stripped", () => {
  const payload = { ...identicalPayload(), major: "Economics" };
  const stripped = computeProvenanceStrip(enrichedRow(), payload, ["current_company"]);
  assert.deepEqual(stripped, []);
});

test("provenance keys outside the tracked field set never strip", () => {
  // e.g. headline/summary are enrichment-filled but not editable via this form.
  const payload = { ...identicalPayload(), current_company: "Globex" };
  const stripped = computeProvenanceStrip(enrichedRow(), payload, [
    "headline",
    "summary",
    "current_company",
  ]);
  assert.deepEqual(stripped, ["current_company"]);
});

test("clearing an enriched field to empty/null strips it", () => {
  const payload = { ...identicalPayload(), industry: null };
  const stripped = computeProvenanceStrip(enrichedRow(), payload, ["industry"]);
  assert.deepEqual(stripped, ["industry"]);
});

test("tracked field set matches the PATCH payload's editable columns", () => {
  // Every tracked provenance field must actually be written by the PATCH
  // payload builder — otherwise the strip compares a key that never changes.
  const payloadKeys = Object.keys(
    buildAlumniWritePayload({
      first_name: "A",
      last_name: "B",
      email: "",
      graduation_year: "",
      birth_year: "",
      major: "",
      job_title: "",
      photo_url: "",
      notes: "",
      linkedin_url: "",
      phone_number: "",
      industry: "",
      current_company: "",
      current_city: "",
      position_title: "",
    })
  );
  for (const field of ENRICHMENT_PROVENANCE_FIELDS) {
    assert.ok(payloadKeys.includes(field), `payload must write ${field}`);
  }
});

// ── Source asserts: edit page → form → PATCH route wiring ───────────────────

test("edit page passes enrichmentFilledFields to EditAlumniForm", () => {
  assert.match(
    editPageSource,
    /enrichmentFilledFields=\{alum\.enrichment_filled_fields \?\? null\}/
  );
});

test("form accepts the prop and gates chips on the provenance list", () => {
  assert.match(formSource, /enrichmentFilledFields\?: string\[\] \| null/);
  assert.match(formSource, /Filled from LinkedIn — editing makes it yours/);
  // Chip renders nothing without a list, and only for fields IN the list.
  assert.match(
    formSource,
    /if \(!filledFields \|\| !ENRICHMENT_CHIP_FIELDS\.has\(field\) \|\| !filledFields\.includes\(field\)\) \{\s*return null;/
  );
  // Chips only exist for tracked, form-editable columns.
  for (const field of ENRICHMENT_PROVENANCE_FIELDS) {
    assert.match(
      formSource,
      new RegExp(`<EnrichmentChip field="${field}" filledFields=\\{enrichmentFilledFields\\} />`),
      `expected a chip slot for ${field}`
    );
  }
});

test("PATCH route computes the strip from the pre-update row and isolates failure", () => {
  assert.match(routeSource, /computeProvenanceStrip\(/);
  // Pre-update row read includes provenance + tracked columns.
  assert.match(
    routeSource,
    /"id, user_id, job_title, position_title, current_company, current_city, major, industry, photo_url, enrichment_filled_fields"/
  );
  // Strip only runs when the row has a non-null, non-empty provenance list.
  assert.match(routeSource, /filledFields && filledFields\.length > 0/);
  // Removed keys are filtered out, not replaced wholesale.
  assert.match(
    routeSource,
    /filledFields\.filter\(\(field\) => !strippedKeys\.includes\(field\)\)/
  );
  // Strip failure logs with context and does NOT fail the request: the
  // stripError branch only console.errors — no NextResponse/throw inside it.
  const stripBlock = routeSource.slice(
    routeSource.indexOf("if (stripError) {"),
    routeSource.indexOf("}", routeSource.indexOf("if (stripError) {") + 1)
  );
  assert.match(stripBlock, /console\.error\("\[alumni PATCH\] Provenance strip failed/);
  assert.doesNotMatch(stripBlock, /NextResponse|throw/);
  // The strip happens AFTER the main update succeeded.
  const updateIdx = routeSource.indexOf("const { error: updateError }");
  const stripIdx = routeSource.indexOf("computeProvenanceStrip(");
  assert.ok(updateIdx > -1 && stripIdx > updateIdx, "strip must follow the main update");
});
