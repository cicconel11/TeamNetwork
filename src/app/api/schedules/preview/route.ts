import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { detectConnector } from "@/lib/schedule-connectors/registry";
import { maskUrl, normalizeUrl } from "@/lib/schedule-connectors/fetch";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to preview schedules." },
        { status: 401 }
      );
    }

    let body: { orgId?: string; url?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request", message: "Request body must be valid JSON." },
        { status: 400 }
      );
    }

    if (!body.orgId || !body.url) {
      return NextResponse.json(
        { error: "Missing parameters", message: "orgId and url are required." },
        { status: 400 }
      );
    }

    const { data: membership } = await supabase
      .from("user_organization_roles")
      .select("role,status")
      .eq("user_id", user.id)
      .eq("organization_id", body.orgId)
      .maybeSingle();

    if (!membership || membership.status === "revoked") {
      return NextResponse.json(
        { error: "Forbidden", message: "You are not a member of this organization." },
        { status: 403 }
      );
    }

    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeUrl(body.url);
    } catch (error) {
      return NextResponse.json(
        { error: "Invalid URL", message: error instanceof Error ? error.message : "Invalid URL." },
        { status: 400 }
      );
    }

    const { connector } = await detectConnector(normalizedUrl, { orgId: body.orgId });
    const preview = await connector.preview({ url: normalizedUrl, orgId: body.orgId });

    return NextResponse.json({
      vendor: preview.vendor,
      title: preview.title ?? null,
      eventsPreview: preview.events.slice(0, 20),
      inferredMeta: preview.inferredMeta ?? null,
      maskedUrl: maskUrl(normalizedUrl),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to preview schedule.";
    const isClientError = isPreviewClientError(message);
    if (!isClientError) {
      console.error("[schedule-preview] Error:", error);
    }

    return NextResponse.json(
      { error: isClientError ? "Preview failed" : "Internal error", message },
      { status: isClientError ? 400 : 500 }
    );
  }
}

function isPreviewClientError(message: string) {
  const normalized = message.toLowerCase();
  return [
    "no supported schedule connector",
    "url must start with http",
    "domain pending admin approval",
    "domain is blocked",
    "domain is not allowlisted",
    "fetch failed",
    "response exceeds size limit",
    "too many redirects",
    "localhost urls are not allowed",
    "private ips are not allowed",
    "only ports 80 and 443 are allowed",
  ].some((snippet) => normalized.includes(snippet));
}
