import { NextResponse } from "next/server";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { createServiceClient } from "@/lib/supabase/service";
import { baseSchemas } from "@/lib/security/validation";
import { sendNotificationBlast } from "@/lib/notifications";
import { proposalReminderTemplate } from "@/lib/notifications/templates/mentorship/proposal_reminder";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

const BodySchema = z
  .object({
    mentor_user_id: baseSchemas.uuid.optional(),
    min_pending: z.number().int().min(1).max(100).optional(),
  })
  .refine((v) => Boolean(v.mentor_user_id) || typeof v.min_pending === "number", {
    message: "Provide mentor_user_id or min_pending",
  });

type SentEntry = { mentor_user_id: string; pending_count: number };
type SkippedEntry = { mentor_user_id: string; reason: "rate_limited" | "no_pending" };

export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  if (!baseSchemas.uuid.safeParse(organizationId).success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const { supabase, user } = await createAuthenticatedApiClient(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createServiceClient();
  const { data: role } = await service
    .from("user_organization_roles")
    .select("role,status")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (role?.role !== "admin" || role?.status !== "active") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? (err.issues[0]?.message ?? "Invalid body")
        : "Invalid body";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // `mentorship_reminders` is added in a migration not yet reflected in generated types.
  const svc = service as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          gte: (col: string, val: string) => {
            in: (
              col: string,
              vals: string[]
            ) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
          };
        };
      };
      insert: (values: unknown) => Promise<{ error: { message: string } | null }>;
    };
  };

  // Pending proposed pairs for this org — aggregate by mentor.
  const { data: pairsRaw, error: pairsErr } = await service
    .from("mentorship_pairs")
    .select("mentor_user_id, status, deleted_at")
    .eq("organization_id", organizationId)
    .eq("status", "proposed")
    .is("deleted_at", null);

  if (pairsErr) {
    console.error("[mentorship remind] load pairs failed", pairsErr);
    return NextResponse.json({ error: "Failed to load proposals" }, { status: 500 });
  }

  const pendingByMentor = new Map<string, number>();
  for (const row of (pairsRaw ?? []) as Array<{ mentor_user_id: string }>) {
    pendingByMentor.set(row.mentor_user_id, (pendingByMentor.get(row.mentor_user_id) ?? 0) + 1);
  }

  // Pick candidate mentors.
  const candidateMentors: string[] = body.mentor_user_id
    ? [body.mentor_user_id]
    : Array.from(pendingByMentor.entries())
        .filter(([, count]) => count >= (body.min_pending ?? 1))
        .map(([mentorId]) => mentorId);

  if (candidateMentors.length === 0) {
    return NextResponse.json({ sent: [], skipped: [] });
  }

  // Rate-limit lookup — last reminder per candidate mentor in this org.
  const since = new Date(Date.now() - REMINDER_WINDOW_MS).toISOString();
  const { data: recentRemindersRaw } = await svc
    .from("mentorship_reminders")
    .select("mentor_user_id, created_at")
    .eq("organization_id", organizationId)
    .gte("created_at", since)
    .in("mentor_user_id", candidateMentors);

  const rateLimited = new Set(
    ((recentRemindersRaw ?? []) as Array<{ mentor_user_id: string }>).map((r) => r.mentor_user_id)
  );

  // Org slug for review link.
  const { data: orgRow } = await service
    .from("organizations")
    .select("slug")
    .eq("id", organizationId)
    .maybeSingle();
  const reviewLink = orgRow?.slug
    ? `/${orgRow.slug}/mentorship?tab=proposals`
    : "/mentorship";

  const sent: SentEntry[] = [];
  const skipped: SkippedEntry[] = [];

  for (const mentorUserId of candidateMentors) {
    const pendingCount = pendingByMentor.get(mentorUserId) ?? 0;
    if (pendingCount <= 0) {
      skipped.push({ mentor_user_id: mentorUserId, reason: "no_pending" });
      continue;
    }
    if (rateLimited.has(mentorUserId)) {
      skipped.push({ mentor_user_id: mentorUserId, reason: "rate_limited" });
      continue;
    }

    const { title, body: msgBody, category } = proposalReminderTemplate({
      pendingCount,
      reviewLink,
    });

    try {
      await sendNotificationBlast({
        supabase: service,
        organizationId,
        audience: "both",
        channel: "email",
        title,
        body: msgBody,
        targetUserIds: [mentorUserId],
        category,
      });
    } catch (err) {
      console.error("[mentorship remind] notify failed", err);
      // continue — still record attempt? skip recording so retry possible.
      continue;
    }

    const { error: insertErr } = await svc.from("mentorship_reminders").insert({
      organization_id: organizationId,
      mentor_user_id: mentorUserId,
      sent_by: user.id,
      pending_count: pendingCount,
    });

    if (insertErr) {
      console.error("[mentorship remind] insert reminder log failed", insertErr);
    }

    sent.push({ mentor_user_id: mentorUserId, pending_count: pendingCount });
  }

  return NextResponse.json({ sent, skipped });
}
