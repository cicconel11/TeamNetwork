/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(rel: string): Promise<string> {
  return readFile(new URL(rel, import.meta.url), "utf8");
}

const pageSource = await read("../src/app/[orgSlug]/connections/page.tsx");
const cardSource = await read("../src/components/connections/SuggestedConnectionCard.tsx");
const widgetSource = await read("../src/components/connections/PeopleYouShouldMeetWidget.tsx");
const sidebarSource = await read("../src/components/feed/FeedSidebarWidgets.tsx");

// ── Connections page ─────────────────────────────────────────────────────────

test("connections page gates on chat-eligible roles, not admin-only", () => {
  assert.match(pageSource, /CHAT_ELIGIBLE_ORG_ROLES/);
  assert.match(pageSource, /orgCtx\.status === "active"/);
  assert.doesNotMatch(pageSource, /role === "admin"/);
  // Org missing or ineligible viewer → notFound (no leak of the surface).
  assert.match(pageSource, /return notFound\(\)/);
});

test("connections page sources suggestions from the viewer via the shared helper", () => {
  assert.match(pageSource, /getViewerConnectionSuggestions/);
  assert.match(pageSource, /viewerUserId: orgCtx\.userId/);
  assert.match(pageSource, /createServiceClient\(\)/);
});

test("connections page renders distinct empty states for no-source vs no-suggestions", () => {
  assert.match(pageSource, /state === "no_source"/);
  assert.match(pageSource, /noSourceTitle/);
  assert.match(pageSource, /emptyTitle/);
});

test("connections page renders a card per suggestion keyed by person identity", () => {
  assert.match(pageSource, /suggestions\.map/);
  assert.match(pageSource, /SuggestedConnectionCard/);
  assert.match(pageSource, /key=\{`\$\{suggestion\.person_type\}:\$\{suggestion\.person_id\}`\}/);
});

// ── Suggestion card (Message action) ─────────────────────────────────────────

test("card Message action posts to the existing direct-chat/profile route", () => {
  assert.match(cardSource, /action=\{`\/api\/organizations\/\$\{orgId\}\/direct-chat\/profile`\}/);
  assert.match(cardSource, /method="post"/);
});

test("card sends the engine's person_type/person_id straight through as profile fields", () => {
  // person_type maps onto profileType, person_id onto profileId — the bridge the
  // direct-chat route already understands; we do not re-resolve user_id here.
  assert.match(cardSource, /name="profileType" value=\{suggestion\.person_type\}/);
  assert.match(cardSource, /name="profileId" value=\{suggestion\.person_id\}/);
  assert.match(cardSource, /name="orgSlug" value=\{orgSlug\}/);
});

test("card renders a chip per reason label and a subtitle when present", () => {
  assert.match(cardSource, /suggestion\.reasons\.map/);
  assert.match(cardSource, /reason\.label/);
  assert.match(cardSource, /suggestion\.subtitle/);
});

// ── Sidebar entry-point widget ───────────────────────────────────────────────

test("sidebar widget is a teaser that links to the full connections page", () => {
  assert.match(widgetSource, /href=\{`\/\$\{orgSlug\}\/connections`\}/);
  assert.match(widgetSource, /connectionsCta/);
});

test("sidebar composition includes the People You Should Meet widget", () => {
  assert.match(sidebarSource, /PeopleYouShouldMeetWidget/);
  assert.match(sidebarSource, /orgSlug=\{orgSlug\}/);
});
