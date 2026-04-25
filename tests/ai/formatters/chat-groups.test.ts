import test from "node:test";
import assert from "node:assert/strict";
import { formatChatGroupsResponse } from "../../../src/app/api/ai/[orgId]/chat/handler/formatters/reads.ts";

const RECENT = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
const NINE_DAYS = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString();

test("formatChatGroupsResponse renders mine-mode with markdown deep links and last activity", () => {
  const out = formatChatGroupsResponse(
    [
      {
        id: "group-1",
        name: "Admin",
        role: "member",
        updated_at: RECENT,
      },
    ],
    { orgSlug: "acme" },
  );

  assert.ok(out);
  assert.match(out!, /You can message these chat groups:/);
  assert.match(out!, /\[Admin\]\(\/acme\/messages\/chat\/group-1\) \(member\)/);
  assert.match(out!, /Last activity 4d ago/);
});

test("formatChatGroupsResponse falls back to plain name when orgSlug missing", () => {
  const out = formatChatGroupsResponse([
    { id: "group-1", name: "Admin", role: "admin", updated_at: RECENT },
  ]);

  assert.ok(out);
  assert.doesNotMatch(out!, /\(\/[^)]*\/messages\/chat\//);
  assert.match(out!, /- Admin \(admin\)/);
});

test("formatChatGroupsResponse escapes markdown link labels for group names", () => {
  const out = formatChatGroupsResponse(
    [
      {
        id: "group-1",
        name: "Ops [urgent] \\ fallback",
        role: "member",
        updated_at: RECENT,
      },
    ],
    { orgSlug: "acme" },
  );

  assert.ok(out);
  assert.match(
    out!,
    /\[Ops \\\[urgent\\\] \\\\ fallback\]\(\/acme\/messages\/chat\/group-1\)/
  );
});

test("formatChatGroupsResponse renders all-mode with member counts and non-member suffix", () => {
  const out = formatChatGroupsResponse(
    [
      {
        id: "group-1",
        name: "Admin",
        role: "member",
        updated_at: RECENT,
        member_count: 12,
        is_member: true,
      },
      {
        id: "group-2",
        name: "Marketing",
        role: null,
        updated_at: NINE_DAYS,
        member_count: 8,
        is_member: false,
      },
    ],
    { orgSlug: "acme" },
  );

  assert.ok(out);
  assert.match(out!, /Chat groups in this organization:/);
  assert.match(out!, /\[Admin\]\(\/acme\/messages\/chat\/group-1\) \(member\) - 12 members/);
  assert.match(out!, /- Marketing - 8 members - you're not a member/);
  assert.doesNotMatch(out!, /\[Marketing\]/);
});

test("formatChatGroupsResponse returns empty-state copy when no rows match shape", () => {
  const empty = formatChatGroupsResponse([]);
  assert.equal(empty, "You do not have any active chat groups available right now.");
});
