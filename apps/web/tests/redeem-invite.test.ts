import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  redeemInviteWithFallback,
  completeEnterpriseInviteRedemption,
} from "@teammeet/core/invites";
import { createSupabaseStub } from "./utils/supabaseStub";

type Stub = ReturnType<typeof createSupabaseStub>;

function setupAllInvalid(stub: Stub) {
  stub.registerRpc("redeem_enterprise_invite", () => ({
    success: false,
    error: "Invalid invite",
  }));
  stub.registerRpc("redeem_parent_invite", () => ({
    success: false,
    error: "Invalid invite",
  }));
  stub.registerRpc("redeem_org_invite", () => ({
    success: false,
    error: "Invalid invite",
  }));
}

describe("redeemInviteWithFallback", () => {
  let stub: Stub;
  beforeEach(() => {
    stub = createSupabaseStub();
  });

  it("returns the org-flow result when the org RPC succeeds first", async () => {
    let orgCalls = 0;
    let parentCalls = 0;
    let enterpriseCalls = 0;
    stub.registerRpc("redeem_org_invite", (params) => {
      orgCalls++;
      assert.deepEqual(params, { p_code: "ABCD1234" });
      return {
        success: true,
        organization_id: "org-1",
        slug: "stanford-crew",
        name: "Stanford Crew",
        role: "active_member",
      };
    });
    stub.registerRpc("redeem_parent_invite", () => {
      parentCalls++;
      return { success: false };
    });
    stub.registerRpc("redeem_enterprise_invite", () => {
      enterpriseCalls++;
      return { success: false };
    });

    const { result, rpcError } = await redeemInviteWithFallback(
      stub as never,
      "ABCD1234",
    );

    assert.equal(rpcError, null);
    assert.equal(result?.success, true);
    assert.equal(result?.slug, "stanford-crew");
    assert.equal(orgCalls, 1);
    assert.equal(parentCalls, 0, "should not fall through after success");
    assert.equal(enterpriseCalls, 0);
  });

  it("falls through org → parent → enterprise when each returns success:false", async () => {
    const calls: string[] = [];
    stub.registerRpc("redeem_org_invite", () => {
      calls.push("org");
      return { success: false, error: "not org" };
    });
    stub.registerRpc("redeem_parent_invite", () => {
      calls.push("parent");
      return { success: false, error: "not parent" };
    });
    stub.registerRpc("redeem_enterprise_invite", (params) => {
      calls.push("enterprise");
      assert.deepEqual(params, { p_code_or_token: "TOKEN-ABC" });
      return {
        success: true,
        organization_id: "ent-1",
        organization_slug: "ent-slug",
        organization_name: "Ent Org",
      };
    });

    const { result, rpcError } = await redeemInviteWithFallback(
      stub as never,
      "TOKEN-ABC",
    );

    assert.equal(rpcError, null);
    assert.equal(result?.success, true);
    assert.deepEqual(calls, ["org", "parent", "enterprise"]);
    // Normalized fields populate from organization_slug/name aliases.
    assert.equal(result?.slug, "ent-slug");
    assert.equal(result?.name, "Ent Org");
  });

  it("starts with enterprise when preferredFlow is enterprise", async () => {
    const calls: string[] = [];
    stub.registerRpc("redeem_enterprise_invite", () => {
      calls.push("enterprise");
      return {
        success: true,
        slug: "ent-org",
        name: "Ent Org",
      };
    });
    stub.registerRpc("redeem_org_invite", () => {
      calls.push("org");
      return { success: false };
    });

    const { result } = await redeemInviteWithFallback(
      stub as never,
      "TOK",
      "enterprise",
    );

    assert.equal(result?.success, true);
    assert.deepEqual(calls, ["enterprise"]);
  });

  it("returns choose_org status with available organizations for enterprise invites", async () => {
    stub.registerRpc("redeem_enterprise_invite", () => ({
      success: true,
      status: "choose_org",
      role: "active_member",
      invite_token: "tok-xyz",
      organizations: [
        { id: "org-a", name: "Org A", slug: "org-a", description: null },
        { id: "org-b", name: "Org B", slug: "org-b", description: "desc" },
      ],
    }));

    const { result } = await redeemInviteWithFallback(
      stub as never,
      "CODE",
      "enterprise",
    );

    assert.equal(result?.success, true);
    assert.equal(result?.status, "choose_org");
    assert.equal(result?.organizations?.length, 2);
    assert.equal(result?.invite_token, "tok-xyz");
  });

  it("surfaces the last unsuccessful result when no flow returns success", async () => {
    setupAllInvalid(stub);

    const { result, rpcError } = await redeemInviteWithFallback(
      stub as never,
      "BAD-CODE",
    );

    // When all flows return success:false, the last non-error result is returned
    // so the caller can show the specific error from the RPC.
    assert.equal(rpcError, null);
    assert.equal(result?.success, false);
    assert.equal(result?.error, "Invalid invite");
  });

  it("returns generic rpcError when every flow throws transport errors", async () => {
    stub.registerRpc("redeem_org_invite", () => {
      throw new Error("transport-fail-org");
    });
    stub.registerRpc("redeem_parent_invite", () => {
      throw new Error("transport-fail-parent");
    });
    stub.registerRpc("redeem_enterprise_invite", () => {
      throw new Error("transport-fail-enterprise");
    });

    const { result, rpcError } = await redeemInviteWithFallback(
      stub as never,
      "BAD",
    );

    assert.equal(result, null);
    // Last RPC error message is bubbled up
    assert.equal(rpcError, "transport-fail-enterprise");
  });

  it("trims whitespace from the invite code before calling RPCs", async () => {
    let captured: unknown;
    stub.registerRpc("redeem_org_invite", (params) => {
      captured = params;
      return { success: true, slug: "x", name: "X" };
    });

    await redeemInviteWithFallback(stub as never, "  ABCD1234  ");

    assert.deepEqual(captured, { p_code: "ABCD1234" });
  });
});

describe("completeEnterpriseInviteRedemption", () => {
  it("calls complete_enterprise_invite_redemption with token + org id", async () => {
    const stub = createSupabaseStub();
    let captured: unknown;
    stub.registerRpc("complete_enterprise_invite_redemption", (params) => {
      captured = params;
      return {
        success: true,
        organization_slug: "chosen-org",
        organization_name: "Chosen Org",
      };
    });

    const { result, rpcError } = await completeEnterpriseInviteRedemption(
      stub as never,
      "tok-xyz",
      "11111111-1111-1111-1111-111111111111",
    );

    assert.equal(rpcError, null);
    assert.equal(result?.success, true);
    // Slug normalizes from organization_slug alias.
    assert.equal(result?.slug, "chosen-org");
    assert.deepEqual(captured, {
      p_token: "tok-xyz",
      p_organization_id: "11111111-1111-1111-1111-111111111111",
    });
  });

  it("returns rpcError when the RPC errors", async () => {
    const stub = createSupabaseStub();
    stub.registerRpc("complete_enterprise_invite_redemption", () => {
      throw new Error("invite expired");
    });

    const { result, rpcError } = await completeEnterpriseInviteRedemption(
      stub as never,
      "tok",
      "22222222-2222-2222-2222-222222222222",
    );

    assert.equal(result, null);
    assert.equal(rpcError, "invite expired");
  });
});
