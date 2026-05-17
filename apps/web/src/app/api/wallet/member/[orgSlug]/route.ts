import { NextResponse } from "next/server";
import { z } from "zod";
import { generateMemberPass } from "@teammeet/wallet";
import { getCurrentUser, getOrgContext } from "@/lib/auth/roles";
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

function readPassEnv(): PassEnv | null {
  const passTypeIdentifier = process.env.APPLE_PASS_TYPE_ID_MEMBER;
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

export async function GET(req: Request, ctx: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug: rawOrgSlug } = await ctx.params;
  const slugParse = baseSchemas.slug.safeParse(rawOrgSlug);
  if (!slugParse.success) {
    return NextResponse.json({ error: "Invalid organization slug" }, { status: 400 });
  }
  const orgSlug = slugParse.data;

  const rateLimit = checkRateLimit(req, {
    userId: null,
    feature: "wallet member pass",
    limitPerIp: 30,
    limitPerUser: 20,
  });
  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const orgContext = await getOrgContext(orgSlug);
  if (!orgContext.organization) {
    return NextResponse.json(
      { error: "Organization not found" },
      { status: 404, headers: rateLimit.headers },
    );
  }
  if (!orgContext.userId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: rateLimit.headers },
    );
  }
  if (orgContext.status !== "active") {
    return NextResponse.json(
      { error: "You must be an active member to install a member card." },
      { status: 403, headers: rateLimit.headers },
    );
  }

  const passEnv = readPassEnv();
  if (!passEnv) {
    return NextResponse.json(
      { error: "Apple Wallet is not configured for this deployment." },
      { status: 503, headers: rateLimit.headers },
    );
  }

  // The member's display name lives on auth.users.user_metadata; getCurrentUser
  // already returned it as part of org context, but re-fetch here so we have
  // the typed User object with metadata accessible.
  const user = await getCurrentUser();
  const meta = (user?.user_metadata ?? {}) as {
    full_name?: string;
    display_name?: string;
    name?: string;
  };
  const displayName =
    meta.display_name?.trim() ||
    meta.full_name?.trim() ||
    meta.name?.trim() ||
    user?.email?.split("@")[0] ||
    "TeamNetwork Member";

  const roleLabelSchema = z.string().min(1).max(48);
  const memberRole = roleLabelSchema.safeParse(
    orgContext.isAdmin
      ? "Admin"
      : orgContext.isActiveMember
        ? "Member"
        : orgContext.isAlumni
          ? "Alumni"
          : orgContext.isParent
            ? "Parent"
            : "Member",
  );

  // Opaque deep-link payload. Phase 4 will sign this so check-in scanners
  // can verify the holder hasn't manually edited the pass.
  const qrPayload = `teammeet://members/${orgSlug}/${orgContext.userId}`;

  let buffer: Buffer;
  try {
    buffer = await generateMemberPass({
      passTypeIdentifier: passEnv.passTypeIdentifier,
      teamIdentifier: passEnv.teamIdentifier,
      organizationName: orgContext.organization.name,
      organizationSlug: orgSlug,
      memberId: orgContext.userId,
      memberDisplayName: displayName,
      memberRole: memberRole.success ? memberRole.data : undefined,
      qrPayload,
      certificates: {
        wwdr: passEnv.wwdr,
        signerCert: passEnv.signerCert,
        signerKey: passEnv.signerKey,
        signerKeyPassphrase: passEnv.signerKeyPassphrase,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build pass";
    console.error("[wallet/member] generation failed:", message);
    return NextResponse.json(
      { error: "Failed to build pass" },
      { status: 500, headers: rateLimit.headers },
    );
  }

  // Wrap the Node Buffer in a Blob so the WHATWG-typed Response constructor
  // accepts it cleanly across runtimes.
  const body = new Blob([new Uint8Array(buffer)], { type: "application/vnd.apple.pkpass" });
  return new NextResponse(body, {
    status: 200,
    headers: {
      ...rateLimit.headers,
      "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": `attachment; filename="${orgSlug}-member-card.pkpass"`,
      "Cache-Control": "no-store",
    },
  });
}
