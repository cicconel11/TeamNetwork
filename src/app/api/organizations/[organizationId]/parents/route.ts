import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, baseSchemas, sanitizeIlikeInput } from "@/lib/security/validation";
import { newParentSchema } from "@/lib/schemas";
import { getOrgMemberRole } from "@/lib/parents/auth";

const parentsQuerySchema = z.object({
  search: z.string().max(200).optional(),
  relationship: z.string().max(100).optional(),
  student_name: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;

  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "org parents list",
    limitPerIp: 60,
    limitPerUser: 40,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) {
    return respond({ error: "Unauthorized" }, 401);
  }

  // Parse and validate query params before any DB I/O
  const { searchParams } = new URL(req.url);
  const rawParams = Object.fromEntries(
    [...searchParams.entries()].filter(([, v]) => v !== "")
  );
  const parsed = parentsQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    const details = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "param"}: ${issue.message}`
    );
    return respond({ error: "Invalid query parameters", details }, 400);
  }

  const { search, relationship, student_name, limit, offset } = parsed.data;

  const serviceSupabase = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let dataQuery = (serviceSupabase as any)
    .from("parents")
    .select(
      "id,first_name,last_name,email,phone_number,photo_url,linkedin_url,student_name,relationship,notes,created_at",
      { count: "exact" }
    )
    .eq("organization_id", organizationId)
    .is("deleted_at", null);

  if (search) {
    const safe = sanitizeIlikeInput(search);
    dataQuery = dataQuery.or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%`);
  }
  if (relationship) {
    dataQuery = dataQuery.eq("relationship", relationship);
  }
  if (student_name) {
    const safe = sanitizeIlikeInput(student_name);
    dataQuery = dataQuery.ilike("student_name", `%${safe}%`);
  }
  dataQuery = dataQuery
    .order("last_name", { ascending: true })
    .range(offset, offset + limit - 1);

  // Membership check and data fetch run concurrently
  const [rawRole, { data: parents, count, error }] = await Promise.all([
    getOrgMemberRole(supabase, user.id, organizationId),
    dataQuery,
  ]);

  // Only admin or active_member can read parents
  const canRead = rawRole === "admin" || rawRole === "active_member" || rawRole === "member";
  if (!canRead) {
    return respond({ error: "Forbidden" }, 403);
  }

  if (error) {
    console.error("[org/parents GET] DB error:", error);
    return respond({ error: "Internal server error" }, 500);
  }

  return respond({
    parents: parents ?? [],
    total: count ?? 0,
    limit,
    offset,
  });
}

export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;

  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "org parents create",
    limitPerIp: 30,
    limitPerUser: 20,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) {
    return respond({ error: "Unauthorized" }, 401);
  }

  // Admin only for writes
  const role = await getOrgMemberRole(supabase, user.id, organizationId);
  if (role !== "admin") {
    return respond({ error: "Forbidden" }, 403);
  }

  let body;
  try {
    body = await validateJson(req, newParentSchema, { maxBodyBytes: 10_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return respond({ error: error.message, details: error.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  const serviceSupabase = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: parent, error: insertError } = await (serviceSupabase as any)
    .from("parents")
    .insert({
      organization_id: organizationId,
      first_name: body.first_name,
      last_name: body.last_name,
      email: body.email ?? null,
      phone_number: body.phone_number ?? null,
      photo_url: body.photo_url ?? null,
      linkedin_url: body.linkedin_url ?? null,
      student_name: body.student_name ?? null,
      relationship: body.relationship ?? null,
      notes: body.notes ?? null,
    })
    .select("id,first_name,last_name,email,phone_number,photo_url,linkedin_url,student_name,relationship,notes,created_at")
    .single();

  if (insertError || !parent) {
    console.error("[org/parents POST] DB error:", insertError);
    return respond({ error: "Internal server error" }, 500);
  }

  return respond({ parent }, 201);
}
