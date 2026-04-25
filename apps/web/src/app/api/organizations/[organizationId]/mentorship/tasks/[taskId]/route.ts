import { NextResponse } from "next/server";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { createServiceClient } from "@/lib/supabase/service";
import { baseSchemas, validateJson, ValidationError } from "@/lib/security/validation";
import { updateTaskSchema, type UpdateTask } from "@/lib/mentorship/schemas";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string; taskId: string }>;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const { organizationId, taskId } = await params;

  // Validate IDs as UUIDs
  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const taskIdParsed = baseSchemas.uuid.safeParse(taskId);
  if (!taskIdParsed.success) {
    return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
  }

  // Auth check
  const { supabase, user } = await createAuthenticatedApiClient(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify organization exists
  const serviceSupabase = createServiceClient();
  const { data: org, error: orgError } = await serviceSupabase
    .from("organizations")
    .select("id")
    .eq("id", organizationId)
    .maybeSingle();

  if (orgError || !org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  // Parse request body
  let body: UpdateTask;
  try {
    body = await validateJson(req, updateTaskSchema, { maxBodyBytes: 100_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message, details: error.details }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Fetch existing task and associated pair
  const { data: task, error: taskError } = await serviceSupabase
    .from("mentorship_tasks")
    .select("id, pair_id, title, description, due_date, status, created_by, organization_id")
    .eq("id", taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (taskError) {
    console.error("[mentorship tasks PATCH] Failed to fetch task:", taskError);
    return NextResponse.json({ error: "Unable to verify task" }, { status: 500 });
  }

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Verify task belongs to the requested organization
  if (task.organization_id !== organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch pair to determine mentor/mentee relationship
  const { data: pair, error: pairError } = await serviceSupabase
    .from("mentorship_pairs")
    .select("id, mentor_user_id, mentee_user_id, deleted_at")
    .eq("id", task.pair_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (pairError) {
    console.error("[mentorship tasks PATCH] Failed to fetch pair:", pairError);
    return NextResponse.json({ error: "Unable to verify pair" }, { status: 500 });
  }

  if (!pair) {
    return NextResponse.json({ error: "Pair not found" }, { status: 404 });
  }

  // Check user role in organization
  const { data: roleData } = await serviceSupabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  const isAdmin = roleData?.role === "admin";

  // Determine user role in the pair
  const isMentor = pair.mentor_user_id === user.id;
  const isMentee = pair.mentee_user_id === user.id;

  // Verify access: must be mentor, mentee, or admin
  if (!isMentor && !isMentee && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // CRITICAL: Mentee field restriction — enforced in code, not just RLS
  if (isMentee && !isAdmin) {
    // Mentees can only update status field
    const bodyKeys = Object.keys(body);
    const hasNonStatusFields = bodyKeys.some((key) => key !== "status");

    if (hasNonStatusFields) {
      return NextResponse.json(
        { error: "Mentees may only update task status" },
        { status: 403 }
      );
    }
  }

  // Construct update object based on role
  const updateData: Database["public"]["Tables"]["mentorship_tasks"]["Update"] = {
    updated_at: new Date().toISOString(),
  };

  // Mentor and admin can update all fields
  if (isMentor || isAdmin) {
    if ("title" in body && body.title !== undefined) {
      updateData.title = body.title;
    }
    if ("description" in body) {
      updateData.description = body.description ?? null;
    }
    if ("due_date" in body) {
      updateData.due_date = body.due_date ?? null;
    }
    if ("status" in body && body.status !== undefined) {
      updateData.status = body.status;
    }
  } else {
    // Mentee can only update status (field restriction already checked above)
    if ("status" in body && body.status !== undefined) {
      updateData.status = body.status;
    }
  }

  // Apply update
  const { data: updatedTask, error: updateError } = await serviceSupabase
    .from("mentorship_tasks")
    .update(updateData)
    .eq("id", taskId)
    .select()
    .single();

  if (updateError) {
    console.error("[mentorship tasks PATCH] Failed to update task:", updateError);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }

  return NextResponse.json({ task: updatedTask }, { status: 200 });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const { organizationId, taskId } = await params;

  // Validate IDs as UUIDs
  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const taskIdParsed = baseSchemas.uuid.safeParse(taskId);
  if (!taskIdParsed.success) {
    return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
  }

  // Auth check
  const { supabase, user } = await createAuthenticatedApiClient(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify organization exists
  const serviceSupabase = createServiceClient();
  const { data: org, error: orgError } = await serviceSupabase
    .from("organizations")
    .select("id")
    .eq("id", organizationId)
    .maybeSingle();

  if (orgError || !org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  // Fetch existing task and associated pair
  const { data: task, error: taskError } = await serviceSupabase
    .from("mentorship_tasks")
    .select("id, pair_id, organization_id")
    .eq("id", taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (taskError) {
    console.error("[mentorship tasks DELETE] Failed to fetch task:", taskError);
    return NextResponse.json({ error: "Unable to verify task" }, { status: 500 });
  }

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Verify task belongs to the requested organization
  if (task.organization_id !== organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch pair to verify caller is mentor
  const { data: pair, error: pairError } = await serviceSupabase
    .from("mentorship_pairs")
    .select("id, mentor_user_id")
    .eq("id", task.pair_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (pairError) {
    console.error("[mentorship tasks DELETE] Failed to fetch pair:", pairError);
    return NextResponse.json({ error: "Unable to verify pair" }, { status: 500 });
  }

  if (!pair) {
    return NextResponse.json({ error: "Pair not found" }, { status: 404 });
  }

  // Check user role in organization
  const { data: roleData } = await serviceSupabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  const isAdmin = roleData?.role === "admin";

  // Verify caller is mentor or admin (mentees cannot delete)
  const isMentor = pair.mentor_user_id === user.id;

  if (!isMentor && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Soft-delete: set deleted_at and updated_at
  const now = new Date().toISOString();
  const { data: deletedTask, error: deleteError } = await serviceSupabase
    .from("mentorship_tasks")
    .update({
      deleted_at: now,
      updated_at: now,
    })
    .eq("id", taskId)
    .select()
    .single();

  if (deleteError) {
    console.error("[mentorship tasks DELETE] Failed to delete task:", deleteError);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }

  return NextResponse.json({ task: deletedTask }, { status: 200 });
}
