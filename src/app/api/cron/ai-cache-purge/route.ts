import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Daily cron job to purge expired AI semantic cache entries.
 */
export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  try {
    const supabase = createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)(
      "purge_expired_ai_semantic_cache"
    );

    if (error) {
      console.error("[ai-cache-purge] purge failed:", error);
      return NextResponse.json(
        { error: "Purge failed", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      deletedCount: data ?? 0,
    });
  } catch (err) {
    console.error("[ai-cache-purge] Error:", err);
    return NextResponse.json({ error: "Failed to purge AI cache" }, { status: 500 });
  }
}
