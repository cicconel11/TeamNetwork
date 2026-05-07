import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import {
  decryptMobileHandoffToken,
  hashMobileHandoffCode,
} from "@/lib/auth/mobile-oauth";

const requestSchema = z.object({
  code: z.string().min(32).max(256),
});

type ConsumeMobileAuthHandoffRow = {
  encrypted_access_token: string;
  encrypted_refresh_token: string;
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid handoff code" }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  const { data, error } = await (serviceClient as any).rpc("consume_mobile_auth_handoff", {
    p_code_hash: hashMobileHandoffCode(parsed.data.code),
  });

  if (error) {
    console.error("[mobile-handoff] Consume RPC failed:", error.message);
    return NextResponse.json({ error: "Unable to consume handoff" }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] as ConsumeMobileAuthHandoffRow | undefined : null;
  if (!row) {
    return NextResponse.json({ error: "Invalid or expired handoff code" }, { status: 400 });
  }

  try {
    return NextResponse.json({
      access_token: decryptMobileHandoffToken(row.encrypted_access_token),
      refresh_token: decryptMobileHandoffToken(row.encrypted_refresh_token),
    });
  } catch (decryptError) {
    console.error("[mobile-handoff] Failed to decrypt consumed handoff:", decryptError);
    return NextResponse.json({ error: "Unable to consume handoff" }, { status: 500 });
  }
}
