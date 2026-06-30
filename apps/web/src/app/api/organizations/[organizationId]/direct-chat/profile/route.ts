import { NextResponse } from "next/server";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import {
  startProfileDirectChat,
  type ProfileDirectChatSupabase,
  type ProfileDirectChatType,
} from "@/lib/chat/profile-direct-chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

type RequestBody = {
  profileType: ProfileDirectChatType;
  profileId: string;
  orgSlug?: string;
};

function isProfileType(value: unknown): value is ProfileDirectChatType {
  return value === "member" || value === "alumni" || value === "parent";
}

async function parseRequestBody(req: Request): Promise<RequestBody | null> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || !isProfileType(body.profileType) || typeof body.profileId !== "string") {
      return null;
    }

    return {
      profileType: body.profileType,
      profileId: body.profileId,
      orgSlug: typeof body.orgSlug === "string" ? body.orgSlug : undefined,
    };
  }

  const form = await req.formData().catch(() => null);
  const profileType = form?.get("profileType");
  const profileId = form?.get("profileId");
  const orgSlug = form?.get("orgSlug");

  if (!isProfileType(profileType) || typeof profileId !== "string") {
    return null;
  }

  return {
    profileType,
    profileId,
    orgSlug: typeof orgSlug === "string" ? orgSlug : undefined,
  };
}

export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  if (!baseSchemas.uuid.safeParse(organizationId).success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const body = await parseRequestBody(req);
  if (!body || !baseSchemas.uuid.safeParse(body.profileId).success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  // Normalize the slug through the schema (trim + lowercase) and redirect with
  // the canonical value — the raw body slug may carry casing/whitespace that
  // passes validation but resolves to a 404 on the case-sensitive slug lookup.
  let canonicalOrgSlug: string | undefined;
  if (body.orgSlug !== undefined) {
    const parsedSlug = baseSchemas.slug.safeParse(body.orgSlug);
    if (!parsedSlug.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    canonicalOrgSlug = parsedSlug.data;
  }

  const { user } = await createAuthenticatedApiClient(req);

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    orgId: organizationId,
    feature: "profile-direct-chat",
    limitPerIp: 30,
    limitPerUser: 20,
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) {
    return respond({ error: "Unauthorized" }, 401);
  }

  // startProfileDirectChat authorizes the viewer (active chat-eligible role)
  // and the target in app code, then writes the chat group. chat_groups INSERT
  // is admin-only under RLS, so the privileged write runs on the service-role
  // client — matching mentorship auto-pairing and the AI direct-chat path.
  const serviceSupabase = createServiceClient();

  const result = await startProfileDirectChat(serviceSupabase as ProfileDirectChatSupabase, {
    organizationId,
    viewerUserId: user.id,
    profileType: body.profileType,
    profileId: body.profileId,
  });

  if (!result.ok) {
    if (result.status >= 500) {
      console.error("[direct-chat/profile POST] Failed to start profile chat", {
        organizationId,
        viewerUserId: user.id,
        profileType: body.profileType,
        profileId: body.profileId,
        code: result.code,
      });
    }
    return respond({ error: result.error, code: result.code }, result.status);
  }

  if (canonicalOrgSlug) {
    const redirectUrl = new URL(
      `/${canonicalOrgSlug}/messages/chat/${result.chatGroupId}`,
      req.url,
    );
    return NextResponse.redirect(redirectUrl, { status: 303 });
  }

  return respond({
    chatGroupId: result.chatGroupId,
    reused: result.reused,
  });
}
