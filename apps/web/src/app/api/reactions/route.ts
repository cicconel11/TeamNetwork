import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  baseSchemas,
  safeString,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";

/**
 * POST /api/reactions — add an emoji reaction.
 * DELETE /api/reactions — remove an emoji reaction (same body shape).
 *
 * RLS handles authorization: a user can only insert/delete reactions on
 * targets in orgs they belong to (see migration 20260508140000). We still
 * resolve the target's organization_id server-side so the client can't lie
 * about it.
 */
export const dynamic = "force-dynamic";

const TARGET_KIND = z.enum(["chat_message", "discussion_reply", "announcement"]);

const schema = z
  .object({
    target_kind: TARGET_KIND,
    target_id: baseSchemas.uuid,
    emoji: safeString(16, 1),
  })
  .strict();

const TARGET_TABLES: Record<z.infer<typeof TARGET_KIND>, string> = {
  chat_message: "chat_messages",
  discussion_reply: "discussion_replies",
  announcement: "announcements",
};

async function resolveOrgId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  kind: z.infer<typeof TARGET_KIND>,
  targetId: string,
): Promise<string | null> {
  const { data } = await client
    .from(TARGET_TABLES[kind])
    .select("organization_id")
    .eq("id", targetId)
    .maybeSingle();
  return (data as { organization_id?: string } | null)?.organization_id ?? null;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await validateJson(request, schema, { maxBodyBytes: 4_000 });
    const orgId = await resolveOrgId(supabase, body.target_kind, body.target_id);
    if (!orgId) {
      return NextResponse.json({ error: "Target not found" }, { status: 404 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = supabase as any;
    const { error } = await svc.from("reactions").upsert(
      {
        target_kind: body.target_kind,
        target_id: body.target_id,
        user_id: user.id,
        organization_id: orgId,
        emoji: body.emoji,
      },
      { onConflict: "target_kind,target_id,user_id,emoji", ignoreDuplicates: true },
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof ValidationError) return validationErrorResponse(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await validateJson(request, schema, { maxBodyBytes: 4_000 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = supabase as any;
    const { error } = await svc
      .from("reactions")
      .delete()
      .eq("target_kind", body.target_kind)
      .eq("target_id", body.target_id)
      .eq("user_id", user.id)
      .eq("emoji", body.emoji);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof ValidationError) return validationErrorResponse(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
