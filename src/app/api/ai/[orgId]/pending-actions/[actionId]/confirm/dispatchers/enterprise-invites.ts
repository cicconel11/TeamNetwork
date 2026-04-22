/* eslint-disable @typescript-eslint/no-explicit-any */
// Domain dispatchers for `create_enterprise_invite` and
// `revoke_enterprise_invite`. Pairs in a single file because they operate on
// the same enterprise_invites table and are the only dispatchers that use the
// auth-bound supabase client (for the RPC; revoke uses serviceSupabase).

import { NextResponse } from "next/server";
import type { AiLogContext } from "@/lib/ai/logger";
import { aiLog } from "@/lib/ai/logger";
import type {
  CreateEnterpriseInvitePendingPayload,
  PendingActionRecord,
  RevokeEnterpriseInvitePendingPayload,
  updatePendingActionStatus,
} from "@/lib/ai/pending-actions";

export interface EnterpriseInviteDispatcherContext {
  supabase: any; // auth-bound client (required for create_enterprise_invite RPC)
  serviceSupabase: any;
  orgId: string;
  userId: string;
  logContext: AiLogContext;
  updatePendingActionStatusFn: typeof updatePendingActionStatus;
}

export async function handleCreateEnterpriseInvite(
  ctx: EnterpriseInviteDispatcherContext,
  action: PendingActionRecord<"create_enterprise_invite">
): Promise<NextResponse> {
  const payload = action.payload as CreateEnterpriseInvitePendingPayload;
  const rpcResult = await (ctx.supabase as any).rpc("create_enterprise_invite", {
    p_enterprise_id: payload.enterpriseId,
    p_organization_id: payload.organizationId ?? null,
    p_role: payload.role,
    p_uses: payload.usesRemaining ?? null,
    p_expires_at: payload.expiresAt ?? null,
  });

  if (rpcResult.error || !rpcResult.data || typeof rpcResult.data.id !== "string") {
    await ctx.updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
      status: "pending",
      expectedStatus: "confirmed",
    });
    return NextResponse.json(
      { error: rpcResult.error?.message || "Failed to create enterprise invite" },
      { status: 400 }
    );
  }

  const invite = rpcResult.data as {
    id: string;
    code?: string;
    role?: string;
  };

  await ctx.updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
    status: "executed",
    expectedStatus: "confirmed",
    executedAt: new Date().toISOString(),
    resultEntityType: "enterprise_invite",
    resultEntityId: invite.id,
  });

  const inviteCode = typeof invite.code === "string" ? invite.code : "";
  const invitePath = `/enterprise/${payload.enterpriseSlug}/invites`;
  const content = inviteCode
    ? `Created enterprise invite \`${inviteCode}\` (${payload.role}). Manage it at [${invitePath}](${invitePath}).`
    : `Created enterprise invite (${payload.role}). Manage it at [${invitePath}](${invitePath}).`;

  const { error: msgError } = await ctx.serviceSupabase.from("ai_messages").insert({
    thread_id: action.thread_id,
    org_id: ctx.orgId,
    role: "assistant",
    content,
    status: "complete",
  });

  if (msgError) {
    aiLog(
      "error",
      "ai-confirm",
      "failed to insert confirmation message",
      {
        ...ctx.logContext,
        userId: ctx.userId,
        threadId: action.thread_id,
      },
      {
        actionId: action.id,
        error: msgError,
      }
    );
  }

  return NextResponse.json({ ok: true, invite, actionId: action.id });
}

export async function handleRevokeEnterpriseInvite(
  ctx: EnterpriseInviteDispatcherContext,
  action: PendingActionRecord<"revoke_enterprise_invite">
): Promise<NextResponse> {
  const payload = action.payload as RevokeEnterpriseInvitePendingPayload;
  const updateResult = await (ctx.serviceSupabase as any)
    .from("enterprise_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", payload.inviteId)
    .eq("enterprise_id", payload.enterpriseId)
    .is("revoked_at", null)
    .select("id");

  const updatedRows = Array.isArray(updateResult.data) ? updateResult.data : [];

  if (updateResult.error || updatedRows.length === 0) {
    await ctx.updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
      status: "pending",
      expectedStatus: "confirmed",
    });
    return NextResponse.json(
      { error: updateResult.error?.message || "Failed to revoke enterprise invite" },
      { status: 400 }
    );
  }

  await ctx.updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
    status: "executed",
    expectedStatus: "confirmed",
    executedAt: new Date().toISOString(),
    resultEntityType: "enterprise_invite",
    resultEntityId: payload.inviteId,
  });

  const content = `Revoked enterprise invite \`${payload.inviteCode}\`.`;
  const { error: msgError } = await ctx.serviceSupabase.from("ai_messages").insert({
    thread_id: action.thread_id,
    org_id: ctx.orgId,
    role: "assistant",
    content,
    status: "complete",
  });

  if (msgError) {
    aiLog(
      "error",
      "ai-confirm",
      "failed to insert confirmation message",
      {
        ...ctx.logContext,
        userId: ctx.userId,
        threadId: action.thread_id,
      },
      {
        actionId: action.id,
        error: msgError,
      }
    );
  }

  return NextResponse.json({ ok: true, actionId: action.id });
}
