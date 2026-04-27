import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { editAnnouncementSchema, type EditAnnouncementForm } from "@/lib/schemas/content";

type DatabaseClient = SupabaseClient<Database>;

export interface UpdateAnnouncementRequest {
  supabase: DatabaseClient;
  orgId: string;
  userId: string;
  announcementId: string;
  input: EditAnnouncementForm;
}

export type UpdateAnnouncementResult =
  | {
      ok: true;
      status: 200;
      announcement: Database["public"]["Tables"]["announcements"]["Row"];
    }
  | {
      ok: false;
      status: 400 | 403 | 404 | 500;
      error: string;
      details?: string[];
    };

export async function updateAnnouncement(
  request: UpdateAnnouncementRequest
): Promise<UpdateAnnouncementResult> {
  const validation = editAnnouncementSchema.safeParse(request.input);
  if (!validation.success) {
    return {
      ok: false,
      status: 400,
      error: "Validation failed",
      details: validation.error.issues.map(
        (issue) => `${issue.path.join(".") || "body"}: ${issue.message}`
      ),
    };
  }

  const membership = await getOrgMembership(request.supabase, request.userId, request.orgId);
  if (!membership || membership.role !== "admin") {
    return { ok: false, status: 403, error: "You do not have permission to update announcements" };
  }

  const { data: existing, error: lookupError } = await request.supabase
    .from("announcements")
    .select("id, organization_id, deleted_at")
    .eq("id", request.announcementId)
    .eq("organization_id", request.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (lookupError) {
    return { ok: false, status: 500, error: "Failed to load announcement" };
  }
  if (!existing) {
    return { ok: false, status: 404, error: "Announcement not found" };
  }

  const { data: announcement, error } = await request.supabase
    .from("announcements")
    .update({
      title: validation.data.title,
      body: validation.data.body || null,
      is_pinned: validation.data.is_pinned,
      audience: validation.data.audience,
      updated_at: new Date().toISOString(),
    })
    .eq("id", request.announcementId)
    .eq("organization_id", request.orgId)
    .is("deleted_at", null)
    .select("*")
    .single();

  if (error || !announcement) {
    return { ok: false, status: 500, error: "Failed to update announcement" };
  }

  return { ok: true, status: 200, announcement };
}

export interface DeleteAnnouncementRequest {
  supabase: DatabaseClient;
  orgId: string;
  userId: string;
  announcementId: string;
}

export type DeleteAnnouncementResult =
  | { ok: true; status: 200; announcementId: string }
  | { ok: false; status: 403 | 404 | 500; error: string };

export async function deleteAnnouncement(
  request: DeleteAnnouncementRequest
): Promise<DeleteAnnouncementResult> {
  const membership = await getOrgMembership(request.supabase, request.userId, request.orgId);
  if (!membership || membership.role !== "admin") {
    return { ok: false, status: 403, error: "You do not have permission to delete announcements" };
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await request.supabase
    .from("announcements")
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq("id", request.announcementId)
    .eq("organization_id", request.orgId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error: "Failed to delete announcement" };
  }
  if (!data) {
    return { ok: false, status: 404, error: "Announcement not found" };
  }

  return { ok: true, status: 200, announcementId: data.id };
}
