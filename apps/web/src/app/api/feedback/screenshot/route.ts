import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  checkRateLimit,
  buildRateLimitResponse,
} from "@/lib/security/rate-limit";
import { isAnonymousFrictionAllowed } from "@/lib/feedback/anonymous-friction";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "feedback-screenshots";
const HOUR_MS = 60 * 60 * 1000;
const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

function extForMime(mime: string): string {
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const formData = await request.formData();
    const file = formData.get("file");
    const contextValue = formData.get("context");
    const triggerValue = formData.get("trigger");
    const context =
      typeof contextValue === "string" ? contextValue.trim() : "";
    const trigger =
      typeof triggerValue === "string" ? triggerValue.trim() : "";

    if (!user && !isAnonymousFrictionAllowed(context, trigger)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const anonymous = !user;
    const rateLimit = checkRateLimit(request, {
      userId: user?.id ?? null,
      feature: anonymous
        ? "feedback screenshot upload (anonymous)"
        : "feedback screenshot upload",
      limitPerIp: anonymous ? 5 : 20,
      limitPerUser: anonymous ? 0 : 10,
      windowMs: HOUR_MS,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { error: "file is required" },
        { status: 400, headers: rateLimit.headers },
      );
    }

    const mimeType = (file as Blob).type || "";
    if (!ALLOWED.has(mimeType)) {
      return NextResponse.json(
        { error: "Invalid image type" },
        { status: 400, headers: rateLimit.headers },
      );
    }

    const size = (file as Blob).size;
    if (size <= 0 || size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File size must be under 5MB" },
        { status: 400, headers: rateLimit.headers },
      );
    }

    const buf = Buffer.from(await (file as Blob).arrayBuffer());
    const ext = extForMime(mimeType);
    const prefix = user?.id ?? "anonymous";
    const path = `${prefix}/${randomUUID()}.${ext}`;

    const service = createServiceClient();
    const { error: uploadError } = await service.storage
      .from(BUCKET)
      .upload(path, buf, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      console.error("[feedback/screenshot] Upload error:", uploadError);
      return NextResponse.json(
        { error: "Failed to upload screenshot" },
        { status: 500, headers: rateLimit.headers },
      );
    }

    const {
      data: { publicUrl },
    } = service.storage.from(BUCKET).getPublicUrl(path);

    return NextResponse.json(
      { screenshot_url: publicUrl },
      { status: 200, headers: rateLimit.headers },
    );
  } catch (err) {
    console.error("[feedback/screenshot] Error:", err);
    return NextResponse.json(
      { error: "Failed to process upload" },
      { status: 500 },
    );
  }
}
