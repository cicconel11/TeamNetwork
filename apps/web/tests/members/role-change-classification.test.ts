import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isTerminalRoleChangeError,
  toUserSafeRoleChangeMessage,
  type ExecuteFailureReason,
} from "@/lib/members/role-change";

const ALL_REASONS: ExecuteFailureReason[] = [
  "target_not_found",
  "no_change",
  "last_admin_self_demotion",
  "last_admin_target_demotion",
  "alumni_upgrade_required",
  "parent_upgrade_required",
  "actor_not_admin",
  "lookup_failed",
  "update_failed",
  "audit_failed",
];

const TERMINAL: ExecuteFailureReason[] = [
  "actor_not_admin",
  "last_admin_self_demotion",
  "last_admin_target_demotion",
  "no_change",
  "alumni_upgrade_required",
  "parent_upgrade_required",
  "target_not_found",
];

const TRANSIENT: ExecuteFailureReason[] = ["update_failed", "lookup_failed", "audit_failed"];

describe("isTerminalRoleChangeError", () => {
  it("classifies every terminal reason as terminal", () => {
    for (const reason of TERMINAL) {
      assert.equal(isTerminalRoleChangeError(reason), true, `expected ${reason} terminal`);
    }
  });

  it("classifies every transient reason as transient", () => {
    for (const reason of TRANSIENT) {
      assert.equal(isTerminalRoleChangeError(reason), false, `expected ${reason} transient`);
    }
  });

  it("covers every ExecuteFailureReason member", () => {
    const seen = new Set([...TERMINAL, ...TRANSIENT]);
    for (const reason of ALL_REASONS) {
      assert.ok(seen.has(reason), `${reason} missing from terminal/transient buckets`);
    }
    assert.equal(seen.size, ALL_REASONS.length, "duplicates or gaps in classification buckets");
  });
});

describe("toUserSafeRoleChangeMessage", () => {
  it("returns a non-empty message for every reason", () => {
    for (const reason of ALL_REASONS) {
      const message = toUserSafeRoleChangeMessage(reason);
      assert.equal(typeof message, "string");
      assert.ok(message.length > 0, `${reason} mapped to empty string`);
    }
  });
});
