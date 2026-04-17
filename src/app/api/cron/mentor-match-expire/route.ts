import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXPIRY_DAYS = 14;

// Phase 2 columns/tables not yet in generated DB types.
type StaleRow = { id: string; organization_id: string; proposed_at: string | null };

export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const service = createServiceClient();
  const cutoff = new Date(Date.now() - EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const pairsQuery = service
    .from("mentorship_pairs")
    .select("id, organization_id, proposed_at")
    .eq("status", "proposed")
    .is("deleted_at", null) as unknown as {
      lt: (col: string, val: string) => Promise<{ data: StaleRow[] | null; error: { message: string } | null }>;
    };

  const { data: stale, error: selectError } = await pairsQuery.lt("proposed_at", cutoff);

  if (selectError) {
    console.error("[cron/mentor-match-expire] fetch failed", selectError);
    return NextResponse.json({ error: selectError.message }, { status: 500 });
  }

  const rows = stale ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ expired: 0 });
  }

  const ids = rows.map((r) => r.id);
  const { error: updateError } = await service
    .from("mentorship_pairs")
    .update({ status: "expired" })
    .in("id", ids)
    .eq("status", "proposed");

  if (updateError) {
    console.error("[cron/mentor-match-expire] update failed", updateError);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const auditRows = rows.map((r) => ({
    organization_id: r.organization_id,
    actor_user_id: null as string | null,
    kind: "mentorship_proposal_expired",
    pair_id: r.id,
    metadata: {
      expired_at: new Date().toISOString(),
      proposed_at: r.proposed_at,
    },
  }));

  const auditTable = (service as unknown as {
    from: (t: string) => { insert: (rows: unknown[]) => Promise<{ error: { message: string } | null }> };
  }).from("mentorship_audit_log");
  await auditTable.insert(auditRows);

  return NextResponse.json({ expired: rows.length });
}
