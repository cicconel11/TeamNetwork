import { NextResponse } from "next/server";
import { z } from "zod";
import { generateEventTicketPass } from "@teammeet/wallet";
import { getCurrentUser } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PassEnv = {
  passTypeIdentifier: string;
  teamIdentifier: string;
  wwdr: string;
  signerCert: string;
  signerKey: string;
  signerKeyPassphrase: string | undefined;
};

function readEventPassEnv(): PassEnv | null {
  const passTypeIdentifier = process.env.APPLE_PASS_TYPE_ID_EVENT;
  const teamIdentifier = process.env.APPLE_PASS_TEAM_ID;
  const wwdr = process.env.APPLE_WWDR_CERT_PEM;
  const signerCert = process.env.APPLE_PASS_SIGNER_CERT_PEM;
  const signerKey = process.env.APPLE_PASS_SIGNER_KEY_PEM;
  if (!passTypeIdentifier || !teamIdentifier || !wwdr || !signerCert || !signerKey) {
    return null;
  }
  return {
    passTypeIdentifier,
    teamIdentifier,
    wwdr,
    signerCert,
    signerKey,
    signerKeyPassphrase: process.env.APPLE_PASS_SIGNER_KEY_PASSPHRASE,
  };
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ eventId: string }> },
) {
  const { eventId: rawEventId } = await ctx.params;
  const idParse = baseSchemas.uuid.safeParse(rawEventId);
  if (!idParse.success) {
    return NextResponse.json({ error: "Invalid event id" }, { status: 400 });
  }
  const eventId = idParse.data;

  const rateLimit = checkRateLimit(req, {
    userId: null,
    feature: "wallet event pass",
    limitPerIp: 30,
    limitPerUser: 20,
  });
  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: rateLimit.headers },
    );
  }

  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select(
      "id, title, start_date, end_date, location, organization_id, organizations(name, slug)",
    )
    .eq("id", eventId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!event) {
    return NextResponse.json(
      { error: "Event not found" },
      { status: 404, headers: rateLimit.headers },
    );
  }

  const org = Array.isArray(event.organizations) ? event.organizations[0] : event.organizations;
  if (!org?.slug || !org?.name) {
    return NextResponse.json(
      { error: "Event organization missing" },
      { status: 500, headers: rateLimit.headers },
    );
  }

  // Verify the requester is actually an attendee. We accept any non-"no"
  // RSVP status as evidence of intent to attend.
  const { data: rsvp } = await supabase
    .from("event_rsvps")
    .select("status")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!rsvp || rsvp.status === "not_attending") {
    return NextResponse.json(
      { error: "RSVP required to install a ticket." },
      { status: 403, headers: rateLimit.headers },
    );
  }

  const passEnv = readEventPassEnv();
  if (!passEnv) {
    return NextResponse.json(
      { error: "Apple Wallet event tickets are not configured for this deployment." },
      { status: 503, headers: rateLimit.headers },
    );
  }

  const meta = (user.user_metadata ?? {}) as {
    full_name?: string;
    display_name?: string;
    name?: string;
  };
  const attendeeDisplayName =
    meta.display_name?.trim() ||
    meta.full_name?.trim() ||
    meta.name?.trim() ||
    user.email?.split("@")[0] ||
    "TeamNetwork Member";

  const titleSchema = z.string().min(1).max(120);
  const titleParse = titleSchema.safeParse(event.title);
  const eventTitle = titleParse.success ? titleParse.data : "Event";

  const qrPayload = `teammeet://events/${org.slug}/${eventId}?u=${user.id}`;

  let buffer: Buffer;
  try {
    buffer = await generateEventTicketPass({
      passTypeIdentifier: passEnv.passTypeIdentifier,
      teamIdentifier: passEnv.teamIdentifier,
      organizationName: org.name,
      organizationSlug: org.slug,
      eventId,
      eventTitle,
      eventStartIso: event.start_date,
      eventLocation: event.location ?? undefined,
      attendeeId: user.id,
      attendeeDisplayName,
      qrPayload,
      certificates: {
        wwdr: passEnv.wwdr,
        signerCert: passEnv.signerCert,
        signerKey: passEnv.signerKey,
        signerKeyPassphrase: passEnv.signerKeyPassphrase,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build ticket";
    console.error("[wallet/event] generation failed:", message);
    return NextResponse.json(
      { error: "Failed to build ticket" },
      { status: 500, headers: rateLimit.headers },
    );
  }

  const body = new Blob([new Uint8Array(buffer)], { type: "application/vnd.apple.pkpass" });
  return new NextResponse(body, {
    status: 200,
    headers: {
      ...rateLimit.headers,
      "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": `attachment; filename="${org.slug}-event-${eventId}.pkpass"`,
      "Cache-Control": "no-store",
    },
  });
}
