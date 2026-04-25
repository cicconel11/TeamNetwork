import { NextResponse } from "next/server";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { createServiceClient } from "@/lib/supabase/service";
import { baseSchemas, validateJson, ValidationError } from "@/lib/security/validation";
import { createTaskSchema } from "@/lib/mentorship/schemas";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

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

  const url = new URL(req.url);
  const pairId = url.searchParams.get("pairId");
  const pairIdParsed = baseSchemas.uuid.safeParse(pairId);
  if (!pairIdParsed.success) {
    return NextResponse.json({ error: "Invalid pair id" }, { status: 400 });
  }

  const { supabase, user } = await createAuthenticatedApiClient(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify caller is pair member or admin
  const { data: pair, error: pairError } = await supabase
    .from("mentorship_pairs")
    .select("mentor_user_id, mentee_user_id")
    .eq("id", pairId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (pairError) {
    console.error("[mentorship tasks GET] Failed to fetch pair:", pairError);
    return NextResponse.json({ error: "Unable to verify pair access" }, { status: 500 });
  }

  if (!pair) {
    return NextResponse.json({ error: "Pair not found" }, { status: 404 });
  }

  // Check if user is mentor, mentee, or admin
  const isMember = pair.mentor_user_id === user.id || pair.mentee_user_id === user.id;

  const serviceSupabase = createServiceClient();
  const { data: roleData } = await serviceSupabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  const isAdmin = roleData?.role === "admin";

  if (!isMember && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch tasks ordered by due_date asc nulls last, then created_at asc
  const { data: tasks, error: tasksError } = await supabase
    .from("mentorship_tasks")
    .select("*")
    .eq("pair_id", pairId)
    .is("deleted_at", null)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (tasksError) {
    console.error("[mentorship tasks GET] Failed to fetch tasks:", tasksError);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }

  return NextResponse.json(tasks);
}

export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const { supabase, user } = await createAuthenticatedApiClient(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = checkRateLimit(req, {
    limitPerIp: 60,
    limitPerUser: 40,
    userId: user.id,
    feature: "mentorship task management",
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  let body;
  try {
    body = await validateJson(req, createTaskSchema, { maxBodyBytes: 100_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message, details: error.details }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const serviceSupabase = createServiceClient();

  // Verify pair exists and is not deleted
  const { data: pair, error: pairError } = await serviceSupabase
    .from("mentorship_pairs")
    .select("id, mentor_user_id, organization_id")
    .eq("id", body.pair_id)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (pairError) {
    console.error("[mentorship tasks POST] Failed to fetch pair:", pairError);
    return NextResponse.json({ error: "Unable to verify pair" }, { status: 500 });
  }

  if (!pair) {
    return NextResponse.json({ error: "Pair not found" }, { status: 404 });
  }

  // Verify caller is mentor of the pair or admin
  const { data: roleData } = await serviceSupabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  const isAdmin = roleData?.role === "admin";
  const isMentor = pair.mentor_user_id === user.id;

  if (!isMentor && !isAdmin) {
    return NextResponse.json({ error: "Only mentors and admins can create tasks" }, { status: 403 });
  }

  // Insert task (org_id will be overwritten by trigger from pair's org_id)
  const { data: task, error: insertError } = await serviceSupabase
    .from("mentorship_tasks")
    .insert({
      pair_id: body.pair_id,
      organization_id: pair.organization_id,
      title: body.title,
      description: body.description || null,
      due_date: body.due_date || null,
      status: body.status || "todo",
      created_by: user.id,
    })
    .select()
    .single();

  if (insertError) {
    console.error("[mentorship tasks POST] Failed to insert task:", insertError);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }

  return NextResponse.json({ task }, { status: 201 });
}
