import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeEventTitle, escapeHtml, sanitizeEventTitleForEmail, getTitleForHash } from "../src/lib/schedule-connectors/sanitize";

test("sanitizeEventTitle strips HTML tags", () => {
  assert.equal(sanitizeEventTitle("<b>Game</b>"), "Game");
  assert.equal(sanitizeEventTitle("<strong>Match</strong>"), "Match");
  assert.equal(sanitizeEventTitle("<a href='https://example.com'>Link</a>"), "Link");
  assert.equal(sanitizeEventTitle("<div class='event'>Event</div>"), "Event");
});

test("sanitizeEventTitle removes script and style blocks completely", () => {
  assert.equal(sanitizeEventTitle("<script>alert(1)</script>"), "Untitled Event");
  assert.equal(sanitizeEventTitle("<script>alert('xss')</script>Game"), "Game");
  assert.equal(sanitizeEventTitle("<style>.hide{display:none}</style>Event"), "Event");
  assert.equal(sanitizeEventTitle("Pre<script>bad</script>Post"), "PrePost");
});

test("sanitizeEventTitle preserves encoded angle brackets (XSS prevention)", () => {
  // CRITICAL: &lt; and &gt; must NOT be decoded to prevent XSS
  assert.equal(
    sanitizeEventTitle("&lt;script&gt;alert(1)&lt;/script&gt;"),
    "&lt;script&gt;alert(1)&lt;/script&gt;"
  );
  assert.equal(
    sanitizeEventTitle("Team &lt;A&gt; vs Team &lt;B&gt;"),
    "Team &lt;A&gt; vs Team &lt;B&gt;"
  );
  assert.equal(
    sanitizeEventTitle("5 &lt; 10 &gt; 3"),
    "5 &lt; 10 &gt; 3"
  );
});

test("sanitizeEventTitle decodes safe entities", () => {
  assert.equal(sanitizeEventTitle("Game &amp; Match"), "Game & Match");
  assert.equal(sanitizeEventTitle("&quot;Quoted&quot;"), '"Quoted"');
  assert.equal(sanitizeEventTitle("It&#39;s Game Day"), "It's Game Day");
  assert.equal(sanitizeEventTitle("It&#x27;s Time"), "It's Time");
  assert.equal(sanitizeEventTitle("&nbsp;Padded&nbsp;"), "Padded");
});

test("sanitizeEventTitle collapses whitespace", () => {
  assert.equal(sanitizeEventTitle("Game    Day"), "Game Day");
  assert.equal(sanitizeEventTitle("  Trimmed  Event  "), "Trimmed Event");
  assert.equal(sanitizeEventTitle("Line\n\nBreak"), "Line Break");
  assert.equal(sanitizeEventTitle("Tab\t\tSpaces"), "Tab Spaces");
});

test("sanitizeEventTitle returns default for empty input", () => {
  assert.equal(sanitizeEventTitle(""), "Untitled Event");
  assert.equal(sanitizeEventTitle("   "), "Untitled Event");
  assert.equal(sanitizeEventTitle(null), "Untitled Event");
  assert.equal(sanitizeEventTitle(undefined), "Untitled Event");
  assert.equal(sanitizeEventTitle(123), "Untitled Event");
  assert.equal(sanitizeEventTitle({}), "Untitled Event");
});

test("sanitizeEventTitle truncates to exactly 200 chars with ellipsis", () => {
  const longTitle = "A".repeat(250);
  const result = sanitizeEventTitle(longTitle);
  assert.equal(result.length, 200);
  assert.ok(result.endsWith("..."));
  assert.equal(result, "A".repeat(197) + "...");
});

test("sanitizeEventTitle does not truncate 200-char titles", () => {
  const exactTitle = "B".repeat(200);
  const result = sanitizeEventTitle(exactTitle);
  assert.equal(result, exactTitle);
  assert.equal(result.length, 200);
});

test("sanitizeEventTitle does not truncate titles under 200 chars", () => {
  const shortTitle = "C".repeat(150);
  const result = sanitizeEventTitle(shortTitle);
  assert.equal(result, shortTitle);
  assert.equal(result.length, 150);
});

test("sanitizeEventTitle handles mixed HTML and entities", () => {
  assert.equal(
    sanitizeEventTitle("<b>Team A</b> &amp; <i>Team B</i>"),
    "Team A & Team B"
  );
  assert.equal(
    sanitizeEventTitle("<span>&quot;Important&quot; Game</span>"),
    '"Important" Game'
  );
});

test("escapeHtml escapes dangerous characters", () => {
  assert.equal(escapeHtml("<script>"), "&lt;script&gt;");
  assert.equal(escapeHtml("a < b > c"), "a &lt; b &gt; c");
  assert.equal(escapeHtml('"quoted"'), "&quot;quoted&quot;");
  assert.equal(escapeHtml("it's"), "it&#x27;s");
  assert.equal(escapeHtml("a & b"), "a &amp; b");
  assert.equal(escapeHtml('<a href="x">'), "&lt;a href=&quot;x&quot;&gt;");
});

test("sanitizeEventTitleForEmail combines sanitization and HTML escaping", () => {
  // First sanitizes (strips tags, decodes safe entities), then escapes for HTML email
  assert.equal(
    sanitizeEventTitleForEmail("<b>Game &amp; Match</b>"),
    "Game &amp; Match"
  );
  // Encoded < and > stay encoded after sanitize, then get double-encoded
  assert.equal(
    sanitizeEventTitleForEmail("&lt;script&gt;"),
    "&amp;lt;script&amp;gt;"
  );
});

test("getTitleForHash falls back for whitespace-only rawTitle", () => {
  assert.equal(getTitleForHash("   ", "Fallback"), "Fallback");
  assert.equal(getTitleForHash("", "Fallback"), "Fallback");
  assert.equal(getTitleForHash(undefined, "Fallback"), "Fallback");
  assert.equal(getTitleForHash("  Valid  ", "Fallback"), "Valid");
});
