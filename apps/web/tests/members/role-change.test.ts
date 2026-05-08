import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  executeMemberRoleChange,
  prepareMemberRoleChange,
  type MemberRoleChangeClient,
} from "@/lib/members/role-change";
import { createSupabaseStub } from "../utils/supabaseStub";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_ID = "33333333-3333-4333-8333-333333333333";

function client() {
  return createSupabaseStub() as unknown as ReturnType<typeof createSupabaseStub> & MemberRoleChangeClient;
}

function seedEnabledOrg(supabase: ReturnType<typeof client>) {
  supabase.seed("organization_subscriptions", [
    {
      organization_id: ORG_ID,
      status: "active",
      alumni_bucket: "0-250",
      parents_bucket: "0-250",
    },
  ]);
}

describe("member role changes", () => {
  it("prepares a role change without mutating the membership row", async () => {
    const supabase = client();
    seedEnabledOrg(supabase);
    supabase.seed("user_organization_roles", [
      { organization_id: ORG_ID, user_id: ACTOR_ID, role: "admin", status: "active" },
      { organization_id: ORG_ID, user_id: TARGET_ID, role: "active_member", status: "active" },
    ]);

    const prepared = await prepareMemberRoleChange(supabase, {
      organizationId: ORG_ID,
      actorUserId: ACTOR_ID,
      targetUserId: TARGET_ID,
      role: "alumni",
    });

    assert.equal(prepared.state, "valid");
    assert.equal(prepared.currentRole, "active_member");
    assert.equal(prepared.nextRole, "alumni");
    assert.equal(
      supabase.getRows("user_organization_roles").find((row) => row.user_id === TARGET_ID)?.role,
      "active_member",
    );
  });

  it("rejects no-op changes before creating pending work", async () => {
    const supabase = client();
    seedEnabledOrg(supabase);
    supabase.seed("user_organization_roles", [
      { organization_id: ORG_ID, user_id: ACTOR_ID, role: "admin", status: "active" },
      { organization_id: ORG_ID, user_id: TARGET_ID, role: "alumni", status: "active" },
    ]);

    const prepared = await prepareMemberRoleChange(supabase, {
      organizationId: ORG_ID,
      actorUserId: ACTOR_ID,
      targetUserId: TARGET_ID,
      role: "alumni",
    });

    assert.deepEqual(prepared, { state: "invalid", reason: "no_change" });
  });

  it("blocks self-demotion when the actor is the only admin", async () => {
    const supabase = client();
    seedEnabledOrg(supabase);
    supabase.seed("user_organization_roles", [
      { organization_id: ORG_ID, user_id: ACTOR_ID, role: "admin", status: "active" },
    ]);

    const prepared = await prepareMemberRoleChange(supabase, {
      organizationId: ORG_ID,
      actorUserId: ACTOR_ID,
      targetUserId: ACTOR_ID,
      role: "alumni",
    });

    assert.deepEqual(prepared, {
      state: "error",
      reason: "last_admin_self_demotion",
      message: "You are the only admin in this organization.",
    });
  });

  it("blocks demoting the final active admin", async () => {
    const supabase = client();
    seedEnabledOrg(supabase);
    supabase.seed("user_organization_roles", [
      { organization_id: ORG_ID, user_id: ACTOR_ID, role: "active_member", status: "active" },
      { organization_id: ORG_ID, user_id: TARGET_ID, role: "admin", status: "active" },
    ]);

    const prepared = await prepareMemberRoleChange(supabase, {
      organizationId: ORG_ID,
      actorUserId: ACTOR_ID,
      targetUserId: TARGET_ID,
      role: "alumni",
    });

    assert.deepEqual(prepared, {
      state: "error",
      reason: "last_admin_target_demotion",
      message: "Cannot demote the only admin.",
    });
  });

  it("blocks alumni and parent roles when the subscription does not include them", async () => {
    const supabase = client();
    supabase.seed("organization_subscriptions", [
      { organization_id: ORG_ID, status: "active", alumni_bucket: "none", parents_bucket: "none" },
    ]);
    supabase.seed("user_organization_roles", [
      { organization_id: ORG_ID, user_id: ACTOR_ID, role: "admin", status: "active" },
      { organization_id: ORG_ID, user_id: TARGET_ID, role: "active_member", status: "active" },
    ]);

    const alumni = await prepareMemberRoleChange(supabase, {
      organizationId: ORG_ID,
      actorUserId: ACTOR_ID,
      targetUserId: TARGET_ID,
      role: "alumni",
    });
    const parent = await prepareMemberRoleChange(supabase, {
      organizationId: ORG_ID,
      actorUserId: ACTOR_ID,
      targetUserId: TARGET_ID,
      role: "parent",
    });

    assert.deepEqual(alumni, {
      state: "error",
      reason: "alumni_upgrade_required",
      message: "Upgrade required for alumni role.",
    });
    assert.deepEqual(parent, {
      state: "error",
      reason: "parent_upgrade_required",
      message: "Upgrade required for parent role.",
    });
  });

  it("executes a valid change and records the AI pending-action audit link", async () => {
    const supabase = client();
    seedEnabledOrg(supabase);
    supabase.seed("user_organization_roles", [
      { organization_id: ORG_ID, user_id: ACTOR_ID, role: "admin", status: "active" },
      { organization_id: ORG_ID, user_id: TARGET_ID, role: "active_member", status: "active" },
    ]);

    const result = await executeMemberRoleChange(supabase, {
      organizationId: ORG_ID,
      actorUserId: ACTOR_ID,
      targetUserId: TARGET_ID,
      role: "alumni",
      source: "ai_pending_action",
      pendingActionId: "pending-1",
      reason: "they stepped down from board",
    });

    assert.equal(result.state, "executed");
    assert.equal(
      supabase.getRows("user_organization_roles").find((row) => row.user_id === TARGET_ID)?.role,
      "alumni",
    );
    assert.deepEqual(
      supabase.getRows("org_member_role_audit").map((row) => ({
        source: row.source,
        pending_action_id: row.pending_action_id,
        actor_user_id: row.actor_user_id,
        previous_role: row.previous_role,
        new_role: row.new_role,
        reason: row.reason,
      })),
      [
        {
          source: "ai_pending_action",
          pending_action_id: "pending-1",
          actor_user_id: ACTOR_ID,
          previous_role: "active_member",
          new_role: "alumni",
          reason: "they stepped down from board",
        },
      ],
    );
  });
});
