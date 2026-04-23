import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  filterAllowedTools,
  getAllowedTools,
  isMemberAccessKilled,
  isToolAllowed,
} from "../src/lib/ai/access-policy.ts";
import { AI_TOOLS } from "../src/lib/ai/tools/definitions.ts";

const ORIGINAL_KILL = process.env.AI_MEMBER_ACCESS_KILL;

function liftKillSwitch() {
  process.env.AI_MEMBER_ACCESS_KILL = "0";
}

function restoreKillSwitch() {
  if (ORIGINAL_KILL === undefined) {
    delete process.env.AI_MEMBER_ACCESS_KILL;
  } else {
    process.env.AI_MEMBER_ACCESS_KILL = ORIGINAL_KILL;
  }
}

describe("ai access policy — kill switch", () => {
  afterEach(restoreKillSwitch);

  it("defaults to killed when env var is unset", () => {
    delete process.env.AI_MEMBER_ACCESS_KILL;
    assert.equal(isMemberAccessKilled(), true);
  });

  it("treats truthy values as killed", () => {
    process.env.AI_MEMBER_ACCESS_KILL = "true";
    assert.equal(isMemberAccessKilled(), true);
    process.env.AI_MEMBER_ACCESS_KILL = "1";
    assert.equal(isMemberAccessKilled(), true);
  });

  it("only lifts when explicitly disabled", () => {
    process.env.AI_MEMBER_ACCESS_KILL = "0";
    assert.equal(isMemberAccessKilled(), false);
    process.env.AI_MEMBER_ACCESS_KILL = "false";
    assert.equal(isMemberAccessKilled(), false);
    process.env.AI_MEMBER_ACCESS_KILL = "off";
    assert.equal(isMemberAccessKilled(), false);
  });
});

describe("ai access policy — admin", () => {
  beforeEach(liftKillSwitch);
  afterEach(restoreKillSwitch);

  it("allows every registered tool for admins", () => {
    const allowed = getAllowedTools({ role: "admin" });
    for (const tool of AI_TOOLS) {
      assert.ok(
        allowed.includes(tool.function.name),
        `admin should be allowed to call ${tool.function.name}`,
      );
    }
  });

  it("allows admin tools even when member kill switch is active", () => {
    process.env.AI_MEMBER_ACCESS_KILL = "1";
    const decision = isToolAllowed({ role: "admin", toolName: "list_members" });
    assert.deepEqual(decision, { allowed: true });
  });

  it("lets admins call enterprise tools (enterprise role is checked downstream)", () => {
    const decision = isToolAllowed({
      role: "admin",
      toolName: "get_enterprise_quota",
    });
    assert.deepEqual(decision, { allowed: true });
  });
});

describe("ai access policy — active_member", () => {
  afterEach(restoreKillSwitch);

  it("denies when kill switch is active", () => {
    process.env.AI_MEMBER_ACCESS_KILL = "1";
    const decision = isToolAllowed({
      role: "active_member",
      toolName: "list_announcements",
    });
    assert.equal(decision.allowed, false);
    if (!decision.allowed) {
      assert.equal(decision.reason, "member_access_kill_switch");
    }
  });

  it("allows the safe read subset when kill is lifted", () => {
    liftKillSwitch();
    const allowed = getAllowedTools({ role: "active_member" });
    assert.deepEqual(new Set(allowed), new Set([
      "list_announcements",
      "list_events",
      "list_discussions",
      "list_job_postings",
      "list_chat_groups",
      "list_philanthropy_events",
      "find_navigation_targets",
    ]));
  });

  it("denies write/prepare tools even when kill is lifted", () => {
    liftKillSwitch();
    const decision = isToolAllowed({
      role: "active_member",
      toolName: "prepare_announcement",
    });
    assert.equal(decision.allowed, false);
  });

  it("denies admin-only analytics tools even when kill is lifted", () => {
    liftKillSwitch();
    const decision = isToolAllowed({
      role: "active_member",
      toolName: "get_donation_analytics",
    });
    assert.equal(decision.allowed, false);
  });

  it("denies member roster tool (admin-only visibility)", () => {
    liftKillSwitch();
    const decision = isToolAllowed({
      role: "active_member",
      toolName: "list_members",
    });
    assert.equal(decision.allowed, false);
  });

  it("denies enterprise tools regardless of enterpriseRole", () => {
    liftKillSwitch();
    const decision = isToolAllowed({
      role: "active_member",
      enterpriseRole: "owner",
      toolName: "list_enterprise_alumni",
    });
    assert.equal(decision.allowed, false);
    if (!decision.allowed) {
      assert.equal(decision.reason, "enterprise_tool_requires_admin");
    }
  });
});

describe("ai access policy — alumni", () => {
  afterEach(restoreKillSwitch);

  it("exposes a stricter read-only subset than active_member", () => {
    liftKillSwitch();
    const allowed = getAllowedTools({ role: "alumni" });
    assert.deepEqual(new Set(allowed), new Set([
      "list_announcements",
      "list_events",
      "find_navigation_targets",
    ]));
  });

  it("denies discussion/job listings that active_member can see", () => {
    liftKillSwitch();
    const decision = isToolAllowed({
      role: "alumni",
      toolName: "list_job_postings",
    });
    assert.equal(decision.allowed, false);
  });
});

describe("ai access policy — parent", () => {
  afterEach(restoreKillSwitch);

  it("is disabled even when kill switch is lifted", () => {
    liftKillSwitch();
    const allowed = getAllowedTools({ role: "parent" });
    assert.deepEqual(allowed, []);

    const decision = isToolAllowed({
      role: "parent",
      toolName: "list_announcements",
    });
    assert.equal(decision.allowed, false);
    if (!decision.allowed) {
      assert.equal(decision.reason, "parent_role_disabled");
    }
  });
});

describe("filterAllowedTools", () => {
  afterEach(restoreKillSwitch);

  it("preserves undefined inputs", () => {
    liftKillSwitch();
    const result = filterAllowedTools(undefined, { role: "active_member" });
    assert.equal(result, undefined);
  });

  it("strips tools that are not allowed for the role", () => {
    liftKillSwitch();
    const tools = [
      AI_TOOLS.find((t) => t.function.name === "list_announcements")!,
      AI_TOOLS.find((t) => t.function.name === "prepare_announcement")!,
    ];
    const filtered = filterAllowedTools(tools, { role: "active_member" });
    assert.equal(filtered?.length, 1);
    assert.equal(filtered?.[0]?.function.name, "list_announcements");
  });

  it("returns an empty list when kill switch blocks all tools", () => {
    process.env.AI_MEMBER_ACCESS_KILL = "1";
    const tools = [AI_TOOLS.find((t) => t.function.name === "list_announcements")!];
    const filtered = filterAllowedTools(tools, { role: "active_member" });
    assert.deepEqual(filtered, []);
  });
});
