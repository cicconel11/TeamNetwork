import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recordBothAgreements } from "@/lib/compliance/user-agreements";
import { hashIp, getClientIp } from "@/lib/compliance/audit-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/auth/accept-terms
 *
 * Records the authenticated user's acceptance of current ToS + Privacy Policy.
 * Called from the OAuth interstitial page and email signup callback.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const clientIp = getClientIp(request);
    const ipHash = clientIp ? hashIp(clientIp) : null;

    await recordBothAgreements({
      userId: user.id,
      ipHash,
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to record agreement" },
      { status: 500 },
    );
  }
}
