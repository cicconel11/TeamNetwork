/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgRole } from "@/lib/auth/roles";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  knowledgeDocumentCreateSchema,
  knowledgeDocumentDeleteSchema,
} from "@/lib/schemas/ai-knowledge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Admin-only authoring API for org knowledge documents (an 8th RAG source).
 * POST creates a document; DELETE soft-deletes one. Both flow into the existing
 * embedding pipeline via the knowledge_documents trigger. No GET/list — authoring
 * is API/seed-driven for now. Audience gating is enforced downstream in the RAG
 * search RPC via the document's audience token.
 */

async function authorize(
  req: Request,
  organizationId: string,
  feature: string
): Promise<
  | { ok: true; userId: string; headers: Record<string, string> }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature,
    limitPerIp: 30,
    limitPerUser: 20,
  });
  if (!rateLimit.ok) {
    return { ok: false, response: buildRateLimitResponse(rateLimit) };
  }

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: rateLimit.headers }
      ),
    };
  }

  try {
    await requireOrgRole({ orgId: organizationId, allowedRoles: ["admin"] });
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Admin access required" },
        { status: 403, headers: rateLimit.headers }
      ),
    };
  }

  return { ok: true, userId: user.id, headers: rateLimit.headers };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ organizationId: string }> }
) {
  const { organizationId } = await params;

  const auth = await authorize(req, organizationId, "ai-knowledge-create");
  if (!auth.ok) return auth.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: auth.headers }
    );
  }

  const parsed = knowledgeDocumentCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400, headers: auth.headers }
    );
  }

  const input = parsed.data;
  const serviceSupabase = createServiceClient();

  const { data, error } = await serviceSupabase
    .from("knowledge_documents")
    .insert({
      organization_id: organizationId,
      created_by: auth.userId,
      title: input.title,
      body: input.body,
      description: input.description ?? null,
      type: input.type ?? null,
      resource: input.resource ?? null,
      tags: input.tags ?? null,
      audience: input.audience,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[ai-knowledge] insert failed:", {
      organizationId,
      error: error?.message,
    });
    return NextResponse.json(
      { error: "Failed to create knowledge document" },
      { status: 500, headers: auth.headers }
    );
  }

  return NextResponse.json({ id: data.id }, { status: 201, headers: auth.headers });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ organizationId: string }> }
) {
  const { organizationId } = await params;

  const auth = await authorize(req, organizationId, "ai-knowledge-delete");
  if (!auth.ok) return auth.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: auth.headers }
    );
  }

  const parsed = knowledgeDocumentDeleteSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400, headers: auth.headers }
    );
  }

  const serviceSupabase = createServiceClient();

  const { data, error } = await serviceSupabase
    .from("knowledge_documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("id", parsed.data.id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[ai-knowledge] soft-delete failed:", {
      organizationId,
      id: parsed.data.id,
      error: error.message,
    });
    return NextResponse.json(
      { error: "Failed to delete knowledge document" },
      { status: 500, headers: auth.headers }
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "Knowledge document not found" },
      { status: 404, headers: auth.headers }
    );
  }

  return NextResponse.json({ id: data.id }, { status: 200, headers: auth.headers });
}
