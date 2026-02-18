import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getEnterpriseApiContext, ENTERPRISE_BILLING_ROLE } from "@/lib/auth/enterprise-api-context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

const querySchema = z.object({
  action: z.string().max(100).optional(),
  actor_user_id: z.string().uuid().optional(),
  target_type: z.string().max(100).optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

interface AuditLogRow {
  id: string;
  actor_user_id: string;
  actor_email_redacted: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  enterprise_id: string;
  organization_id: string | null;
  request_path: string | null;
  request_method: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export async function GET(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;
  const { searchParams } = new URL(req.url);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise audit logs",
    limitPerIp: 60,
    limitPerUser: 40,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  // Only owner or billing_admin can view audit logs
  const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_BILLING_ROLE);
  if (!ctx.ok) return ctx.response;

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  // Parse query parameters
  const rawParams = Object.fromEntries(
    [...searchParams.entries()].filter(([, v]) => v !== "")
  );
  const parsed = querySchema.safeParse(rawParams);

  if (!parsed.success) {
    const details = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "param"}: ${issue.message}`
    );
    return respond({ error: "Invalid query parameters", details }, 400);
  }

  const filters = parsed.data;

  // Build query — exclude ip_address and user_agent to minimize PII exposure
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (ctx.serviceSupabase as any)
    .from("enterprise_audit_logs")
    .select("id, actor_user_id, actor_email_redacted, action, target_type, target_id, enterprise_id, organization_id, request_path, request_method, metadata, created_at", { count: "exact" })
    .eq("enterprise_id", ctx.enterpriseId)
    .order("created_at", { ascending: false })
    .range(filters.offset, filters.offset + filters.limit - 1);

  if (filters.action) {
    query = query.eq("action", filters.action);
  }
  if (filters.actor_user_id) {
    query = query.eq("actor_user_id", filters.actor_user_id);
  }
  if (filters.target_type) {
    query = query.eq("target_type", filters.target_type);
  }
  if (filters.date_from) {
    query = query.gte("created_at", filters.date_from);
  }
  if (filters.date_to) {
    query = query.lte("created_at", filters.date_to);
  }

  const { data: logs, count, error } = await query as {
    data: AuditLogRow[] | null;
    count: number | null;
    error: Error | null;
  };

  if (error) {
    return respond({ error: error.message }, 400);
  }

  return respond({
    logs: logs ?? [],
    total: count ?? 0,
    limit: filters.limit,
    offset: filters.offset,
  });
}
