import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { baseSchemas } from "@/lib/security/validation";
import { ensureDirectChatGroup } from "@/lib/chat/direct-chat";
import { sendNotificationBlast } from "@/lib/notifications";
import { proposalAcceptedTemplate } from "@/lib/notifications/templates/mentorship/proposal_accepted";
import { proposalDeclinedTemplate } from "@/lib/notifications/templates/mentorship/proposal_declined";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  action: z.enum(["accept", "decline", "override_approve"]),
  reason: z.string().trim().max(500).optional(),
});

interface RouteParams {
  params: Promise<{ organizationId: string; pairId: string }>;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const { organizationId, pairId } = await params;
  if (!baseSchemas.uuid.safeParse(organizationId).success ||
      !baseSchemas.uuid.safeParse(pairId).success) {
    return NextResponse.json({ error: "Invalid ids" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const service = createServiceClient();
  // Phase 2 adds accept_mentorship_proposal RPC, mentorship_audit_log table,
  // and declined_at/declined_reason columns not yet reflected in generated types.
  const svc = service as unknown as {
    from: (t: string) => {
      insert: (v: unknown) => Promise<{ error: { message: string } | null }>;
    };
    rpc: (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const userScopedSupabase = supabase as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    from: (t: string) => {
      update: (v: unknown) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => {
            select: (cols: string) => {
              maybeSingle: () => Promise<{
                data: { id: string } | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      };
    };
  };

  const { data: pair } = await service
    .from("mentorship_pairs")
    .select("*")
    .eq("id", pairId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!pair) return NextResponse.json({ error: "Pair not found" }, { status: 404 });

  const { data: callerRole } = await service
    .from("user_organization_roles")
    .select("role,status")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  const isAdmin = callerRole?.role === "admin" && callerRole?.status === "active";
  const isMentor = pair.mentor_user_id === user.id;

  if (body.action === "override_approve" && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if ((body.action === "accept" || body.action === "decline") && !isMentor && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const acceptAlreadyApplied =
    (body.action === "accept" || body.action === "override_approve") &&
    pair.status === "accepted";

  if (
    pair.status !== "proposed" &&
    body.action !== "override_approve" &&
    !acceptAlreadyApplied
  ) {
    return NextResponse.json(
      { error: `cannot ${body.action} pair in status ${pair.status}` },
      { status: 409 }
    );
  }

  const { data: orgRow } = await service
    .from("organizations")
    .select("slug")
    .eq("id", organizationId)
    .maybeSingle();
  const orgSlug = orgRow?.slug ?? "";

  if (body.action === "accept" || body.action === "override_approve") {
    const { data: rpcResult, error: rpcError } = await userScopedSupabase.rpc("accept_mentorship_proposal", {
      pair_id: pairId,
      admin_override: body.action === "override_approve",
    });

    if (rpcError) {
      console.error("[mentorship pair PATCH] accept RPC failed", rpcError);
      return NextResponse.json({ error: rpcError.message }, { status: 409 });
    }

    const rawRow = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
    const row = rawRow as { accepted_at?: string | null; status?: string } | null;
    if (!row) {
      return NextResponse.json({ error: "Accept failed" }, { status: 500 });
    }

    // Chat bootstrap (idempotent, non-blocking)
    const chat = await ensureDirectChatGroup(service, {
      userAId: pair.mentor_user_id,
      userBId: pair.mentee_user_id,
      orgId: organizationId,
    });
    if (!chat.ok) {
      console.error("[mentorship pair PATCH] chat bootstrap failed for pair", pairId);
    }

    // Audit log — non-blocking
    try {
      await svc.from("mentorship_audit_log").insert({
        organization_id: organizationId,
        actor_user_id: user.id,
        kind: body.action === "override_approve" ? "admin_approved" : "proposal_accepted",
        pair_id: pairId,
        metadata: {
          accepted_at: row.accepted_at ?? null,
          chat_reused: chat.ok ? chat.reused : null,
          chat_ok: chat.ok,
        },
      });
    } catch (auditErr) {
      console.error("[mentorship pair PATCH] audit log insert failed", auditErr);
    }

    // Notify mentee — non-blocking
    try {
      const { data: mentorUser } = await service
        .from("users")
        .select("name,email")
        .eq("id", pair.mentor_user_id)
        .maybeSingle();
      const mentorName = mentorUser?.name?.trim() || mentorUser?.email?.trim() || "Your mentor";
      const chatLink = chat.ok
        ? `/${orgSlug}/messages/chat/${chat.chatGroupId}`
        : `/${orgSlug}/mentorship`;
      const { title, body: msgBody } = proposalAcceptedTemplate({ mentorName, chatLink });

      await sendNotificationBlast({
        supabase: service,
        organizationId,
        audience: "both",
        channel: "email",
        title,
        body: msgBody,
        targetUserIds: [pair.mentee_user_id],
        category: "mentorship",
      });
    } catch (err) {
      console.error("[mentorship pair PATCH] accept notify failed", err);
    }

    return NextResponse.json({
      pair_id: pairId,
      chat_group_id: chat.ok ? chat.chatGroupId : null,
      reused_chat: chat.ok ? chat.reused : false,
      chat_failed: !chat.ok,
      status: row.status ?? "accepted",
    });
  }

  // decline — guard against race: require status='proposed' at update time.
  // Supabase returns zero rows (not an error) if another transaction already
  // transitioned the pair (e.g. accept landed first). We treat that as 409.
  const { data: declinedRow, error: declineError } = await userScopedSupabase
    .from("mentorship_pairs")
    .update({
      status: "declined",
      declined_at: new Date().toISOString(),
      declined_reason: body.reason ?? null,
    })
    .eq("id", pairId)
    .eq("status", "proposed")
    .select("id")
    .maybeSingle();

  if (declineError) {
    console.error("[mentorship pair PATCH] decline failed", declineError);
    return NextResponse.json({ error: declineError.message }, { status: 500 });
  }

  if (!declinedRow) {
    return NextResponse.json(
      { error: "cannot decline pair in current status" },
      { status: 409 }
    );
  }

  try {
    await svc.from("mentorship_audit_log").insert({
      organization_id: organizationId,
      actor_user_id: user.id,
      kind: "proposal_declined",
      pair_id: pairId,
      metadata: { reason: body.reason ?? null },
    });
  } catch (auditErr) {
    console.error("[mentorship pair PATCH] audit log insert failed", auditErr);
  }

  // Notify mentee — non-blocking
  try {
    const { data: mentorUser } = await service
      .from("users")
      .select("name,email")
      .eq("id", pair.mentor_user_id)
      .maybeSingle();
    const mentorName = mentorUser?.name?.trim() || mentorUser?.email?.trim() || "Your mentor";
    const directoryLink = `/${orgSlug}/mentorship?tab=directory`;
    const { title, body: msgBody } = proposalDeclinedTemplate({
      mentorName,
      reason: body.reason ?? null,
      directoryLink,
    });

    await sendNotificationBlast({
      supabase: service,
      organizationId,
      audience: "both",
      channel: "email",
      title,
      body: msgBody,
      targetUserIds: [pair.mentee_user_id],
      category: "mentorship",
    });
  } catch (err) {
    console.error("[mentorship pair PATCH] decline notify failed", err);
  }

  return NextResponse.json({ pair_id: pairId, status: "declined" });
}
