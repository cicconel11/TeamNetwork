import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConnectionSubtitle,
  buildDisplayReadySuggestedConnection,
  deriveMatchStrength,
  formatConnectionReasonLabel,
  isStrongReason,
  STRONG_MATCH_MIN_SCORE,
  GOOD_MATCH_MIN_SCORE,
  type SuggestedConnection,
} from "../src/lib/people-graph/scoring.ts";

// ── Subtitle never leaks a role enum (the active_member bug) ──────────────────

test("buildConnectionSubtitle drops raw role enums instead of showing them", () => {
  for (const enumValue of ["active_member", "alumni", "parent", "admin", "viewer", "member"]) {
    // With only a role-enum value and nothing else, the subtitle must be null —
    // never the literal enum text.
    assert.equal(buildConnectionSubtitle({ role: enumValue }), null, `${enumValue} should be dropped`);
  }
});

test("buildConnectionSubtitle keeps a real human role + company", () => {
  assert.equal(
    buildConnectionSubtitle({ role: "Captain", currentCompany: "Acme" }),
    "Captain • Acme"
  );
});

test("buildConnectionSubtitle falls back past an enum role to the next real field", () => {
  // role is a leaked enum → skipped; company is real → it leads.
  assert.equal(
    buildConnectionSubtitle({ role: "active_member", currentCompany: "Deloitte", industry: "Consulting" }),
    "Deloitte • Consulting"
  );
});

// ── Match strength buckets ────────────────────────────────────────────────────

test("deriveMatchStrength buckets by score thresholds", () => {
  assert.equal(deriveMatchStrength(STRONG_MATCH_MIN_SCORE), "strong");
  assert.equal(deriveMatchStrength(STRONG_MATCH_MIN_SCORE - 1), "good");
  assert.equal(deriveMatchStrength(GOOD_MATCH_MIN_SCORE), "good");
  assert.equal(deriveMatchStrength(GOOD_MATCH_MIN_SCORE - 1), "suggested");
  assert.equal(deriveMatchStrength(0), "suggested");
});

// ── Reason labels: human caption + strong flag ────────────────────────────────

test("formatConnectionReasonLabel returns title-case captions, not lowercase", () => {
  assert.equal(formatConnectionReasonLabel("shared_industry"), "Shared industry");
  assert.equal(formatConnectionReasonLabel("graduation_proximity"), "Same grad year");
});

test("isStrongReason marks professional signals, not city/grad-year", () => {
  assert.equal(isStrongReason("shared_industry"), true);
  assert.equal(isStrongReason("shared_company"), true);
  assert.equal(isStrongReason("shared_role_family"), true);
  assert.equal(isStrongReason("shared_city"), false);
  assert.equal(isStrongReason("graduation_proximity"), false);
});

// ── Display-ready projection surfaces detail + strength + messageable ─────────

function baseSuggestion(overrides: Partial<SuggestedConnection> = {}): SuggestedConnection {
  return {
    person_type: "alumni",
    person_id: "p1",
    name: "Jamie Rivera",
    messageable: true,
    score: 30,
    preview: { current_company: "Deloitte", industry: "Consulting" },
    reasons: [
      { code: "shared_industry", weight: 24, value: "Consulting" },
      { code: "graduation_proximity", weight: 3, value: 2026 },
    ],
    ...overrides,
  };
}

test("buildDisplayReadySuggestedConnection surfaces the shared value as reason.detail", () => {
  const display = buildDisplayReadySuggestedConnection(baseSuggestion());
  const industry = display.reasons.find((r) => r.code === "shared_industry");
  const grad = display.reasons.find((r) => r.code === "graduation_proximity");
  assert.equal(industry?.label, "Shared industry");
  assert.equal(industry?.detail, "Consulting");
  assert.equal(industry?.strong, true);
  // numeric value (grad year) is stringified for display
  assert.equal(grad?.detail, "2026");
  assert.equal(grad?.strong, false);
});

test("buildDisplayReadySuggestedConnection carries strength + messageable through", () => {
  const strong = buildDisplayReadySuggestedConnection(baseSuggestion({ score: 30 }));
  assert.equal(strong.strength, "strong");
  assert.equal(strong.messageable, true);

  const unclaimed = buildDisplayReadySuggestedConnection(
    baseSuggestion({ score: 5, messageable: false })
  );
  assert.equal(unclaimed.strength, "suggested");
  assert.equal(unclaimed.messageable, false);
});
