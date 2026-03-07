import { NextRequest, NextResponse } from "next/server";
import { logDevAdminAction, type DevAdminAction } from "@/lib/auth/dev-admin";

export async function POST(request: NextRequest) {
  let body: {
    adminUserId: string;
    adminEmail: string;
    action: DevAdminAction;
    targetType?: "organization" | "member" | "subscription" | "billing" | "enterprise";
    targetId?: string;
    targetSlug?: string;
    requestPath: string;
    requestMethod: string;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.adminUserId || !body.adminEmail || !body.action) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  logDevAdminAction({
    adminUserId: body.adminUserId,
    adminEmail: body.adminEmail,
    action: body.action,
    targetType: body.targetType,
    targetId: body.targetId,
    targetSlug: body.targetSlug,
    requestPath: body.requestPath,
    requestMethod: body.requestMethod,
    ipAddress: body.ipAddress,
    userAgent: body.userAgent,
    metadata: body.metadata,
  });

  return NextResponse.json({ ok: true });
}
