import { NextResponse } from "next/server";
import {
  checkRateLimit,
  buildRateLimitResponse,
} from "@/lib/security/rate-limit";
import {
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import { toggleBlockSchema } from "@/lib/schemas/moderation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOUR_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  let respond:
    | ((payload: unknown, status?: number) => ReturnType<typeof NextResponse.json>)
    | null = null;

  try {
    const { createAuthenticatedApiClient } = await import("@/lib/supabase/api");
    const { supabase, user } = await createAuthenticatedApiClient(request);

    const rateLimit = checkRateLimit(request, {
      userId: user?.id ?? null,
      feature: "toggle block",
      limitPerIp: 90,
      limitPerUser: 60,
      windowMs: HOUR_MS,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    if (!user) {
      return respond({ error: "Unauthorized" }, 401);
    }

    const body = await validateJson(request, toggleBlockSchema, {
      maxBodyBytes: 1_000,
    });

    if (body.blocked_user_id === user.id) {
      return respond({ error: "Cannot block yourself" }, 400);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("toggle_block", {
      p_blocked_id: body.blocked_user_id,
    }) as { data: { blocked: boolean } | null; error: { message: string } | null };

    if (error) {
      console.error("[moderation/block] rpc failed", error);
      return respond({ error: "Failed to toggle block" }, 500);
    }

    return respond({ blocked: data?.blocked ?? false });
  } catch (err) {
    if (err instanceof ValidationError) {
      if (respond) {
        return respond({ error: err.message, details: err.details }, 400);
      }
      return validationErrorResponse(err);
    }
    console.error("[moderation/block] unexpected error", err);
    return NextResponse.json({ error: "Failed to toggle block" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { createAuthenticatedApiClient } = await import("@/lib/supabase/api");
    const { supabase, user } = await createAuthenticatedApiClient(request);

    const rateLimit = checkRateLimit(request, {
      userId: user?.id ?? null,
      feature: "list blocks",
      limitPerIp: 120,
      limitPerUser: 90,
      windowMs: 60_000,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: rateLimit.headers },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("user_blocks")
      .select("blocker_id, blocked_id")
      .is("deleted_at", null)
      .or(`blocker_id.eq.${user.id},blocked_id.eq.${user.id}`) as {
        data: Array<{ blocker_id: string; blocked_id: string }> | null;
        error: { message: string } | null;
      };

    if (error) {
      console.error("[moderation/block GET] query failed", error);
      return NextResponse.json(
        { error: "Failed to load blocks" },
        { status: 500, headers: rateLimit.headers },
      );
    }

    const ids = new Set<string>();
    for (const row of data ?? []) {
      if (row.blocker_id === user.id) ids.add(row.blocked_id);
      if (row.blocked_id === user.id) ids.add(row.blocker_id);
    }

    return NextResponse.json(
      { blocked_user_ids: Array.from(ids) },
      { headers: rateLimit.headers },
    );
  } catch (err) {
    console.error("[moderation/block GET] unexpected error", err);
    return NextResponse.json({ error: "Failed to load blocks" }, { status: 500 });
  }
}
