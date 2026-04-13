import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { recordBothAgreements } from "@/lib/compliance/user-agreements";
import { hashIp, getClientIp } from "@/lib/compliance/audit-log";
import {
  ValidationError,
  validateJson,
  validationErrorResponse,
} from "@/lib/security/validation";

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
    await validateJson(
      request,
      z.object({
        accepted: z.literal(true),
      }),
      { maxBodyBytes: 1_000 },
    );

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const clientIp = getClientIp(request);
    const ipHash = clientIp ? hashIp(clientIp) : null;

    const success = await recordBothAgreements({
      userId: user.id,
      ipHash,
    });

    if (!success) {
      return NextResponse.json(
        { error: "Failed to record agreement" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }

    return NextResponse.json(
      { error: "Failed to record agreement" },
      { status: 500 },
    );
  }
}
