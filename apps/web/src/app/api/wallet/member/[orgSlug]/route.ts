import { NextResponse } from "next/server";
import { z } from "zod";
import { generateMemberPass } from "@teammeet/wallet";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { normalizeRole, roleFlags } from "@/lib/auth/roles";
import type { UserRole } from "@/types/database";
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

  // Authenticate via Bearer token (mobile) or cookies (web). getOrgContext()
  // reads the session from cookies only, so a native request — which sends
  // `Authorization: Bearer <token>` and no cookies — would 401. Resolve the
  // user from the Bearer-aware client and check membership with that same
  // authenticated client (RLS scopes both reads to the caller).
  const { supabase, user } = await createAuthenticatedApiClient(req);
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: rateLimit.headers },
    );
  }

  // The org SELECT runs on the RLS-scoped client, which only exposes orgs the
  // caller belongs to. A non-member therefore gets 404 here (without confirming
  // the org exists); the 403 branch below is reached only by members whose
  // status is non-active (e.g. pending/revoked).
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug")
    .eq("slug", orgSlug)
    .maybeSingle();
  if (!org) {
    return NextResponse.json(
      { error: "Organization not found" },
      { status: 404, headers: rateLimit.headers },
    );
  }

  const { data: membership } = await supabase
    .from("user_organization_roles")
    .select("role, status")
    .eq("organization_id", org.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membership?.status !== "active") {
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

  const meta = (user.user_metadata ?? {}) as {
    full_name?: string;
    display_name?: string;
    name?: string;
  };
  const displayName =
    meta.display_name?.trim() ||
    meta.full_name?.trim() ||
    meta.name?.trim() ||
    user.email?.split("@")[0] ||
    "TeamNetwork Member";

  const flags = roleFlags(normalizeRole((membership.role as UserRole | null) ?? null));
  const roleLabelSchema = z.string().min(1).max(48);
  const memberRole = roleLabelSchema.safeParse(
    flags.isAdmin
      ? "Admin"
      : flags.isActiveMember
        ? "Member"
        : flags.isAlumni
          ? "Alumni"
          : flags.isParent
            ? "Parent"
            : "Member",
  );

  // Opaque deep-link payload. Phase 4 will sign this so check-in scanners
  // can verify the holder hasn't manually edited the pass.
  const qrPayload = `teammeet://members/${orgSlug}/${user.id}`;

  let buffer: Buffer;
  try {
    buffer = await generateMemberPass({
      passTypeIdentifier: passEnv.passTypeIdentifier,
      teamIdentifier: passEnv.teamIdentifier,
      organizationName: org.name,
      organizationSlug: orgSlug,
      memberId: user.id,
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
