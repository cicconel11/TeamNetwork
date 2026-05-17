import { NextResponse } from "next/server";
import { generateDonationReceiptPass } from "@teammeet/wallet";
import { getCurrentUser } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/supabase/service";
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

function readReceiptPassEnv(): PassEnv | null {
  const passTypeIdentifier = process.env.APPLE_PASS_TYPE_ID_RECEIPT;
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

function formatAmount(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: 2,
    }).format(amountCents / 100);
  } catch {
    return `$${(amountCents / 100).toFixed(2)}`;
  }
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ donationId: string }> },
) {
  const { donationId: rawDonationId } = await ctx.params;
  const idParse = baseSchemas.uuid.safeParse(rawDonationId);
  if (!idParse.success) {
    return NextResponse.json({ error: "Invalid donation id" }, { status: 400 });
  }
  const donationId = idParse.data;

  const rateLimit = checkRateLimit(req, {
    userId: null,
    feature: "wallet donation receipt",
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

  // Service client because donations are not RLS-readable by the donor's own
  // session if the donation was made anonymously. Membership / ownership
  // checks are enforced below.
  const service = createServiceClient();
  const { data: donation } = await service
    .from("organization_donations")
    .select(
      "id, amount_cents, currency, donor_name, donor_email, purpose, status, created_at, organization_id, anonymous",
    )
    .eq("id", donationId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!donation) {
    return NextResponse.json(
      { error: "Donation not found" },
      { status: 404, headers: rateLimit.headers },
    );
  }
  if (donation.status !== "succeeded") {
    return NextResponse.json(
      { error: "Receipt is only available after payment succeeds." },
      { status: 409, headers: rateLimit.headers },
    );
  }

  // Authorization: the donor (matched by email) can claim their receipt, OR
  // an org admin can re-issue. Anonymous donations require a signed token in
  // the URL — not implemented here; clients should email the link instead.
  const callerEmail = user.email?.toLowerCase() ?? "";
  const donorEmail = donation.donor_email?.toLowerCase() ?? "";
  const isDonor = donorEmail !== "" && callerEmail === donorEmail;

  let isOrgAdmin = false;
  if (!isDonor) {
    const { data: membership } = await service
      .from("user_organization_roles")
      .select("role, status")
      .eq("organization_id", donation.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();
    isOrgAdmin = membership?.role === "admin" && membership?.status === "active";
  }

  if (!isDonor && !isOrgAdmin) {
    return NextResponse.json(
      { error: "You can only download receipts for your own donations." },
      { status: 403, headers: rateLimit.headers },
    );
  }

  const { data: org } = await service
    .from("organizations")
    .select("name, slug")
    .eq("id", donation.organization_id)
    .maybeSingle();
  if (!org?.slug || !org?.name) {
    return NextResponse.json(
      { error: "Donation organization missing" },
      { status: 500, headers: rateLimit.headers },
    );
  }

  const passEnv = readReceiptPassEnv();
  if (!passEnv) {
    return NextResponse.json(
      { error: "Apple Wallet receipts are not configured for this deployment." },
      { status: 503, headers: rateLimit.headers },
    );
  }

  const donorName = donation.anonymous
    ? "Anonymous"
    : donation.donor_name?.trim() || "Donor";

  let buffer: Buffer;
  try {
    buffer = await generateDonationReceiptPass({
      passTypeIdentifier: passEnv.passTypeIdentifier,
      teamIdentifier: passEnv.teamIdentifier,
      organizationName: org.name,
      organizationSlug: org.slug,
      donationId,
      amountFormatted: formatAmount(donation.amount_cents, donation.currency),
      donorName,
      donatedAtIso: donation.created_at,
      purpose: donation.purpose ?? undefined,
      certificates: {
        wwdr: passEnv.wwdr,
        signerCert: passEnv.signerCert,
        signerKey: passEnv.signerKey,
        signerKeyPassphrase: passEnv.signerKeyPassphrase,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build receipt";
    console.error("[wallet/receipt] generation failed:", message);
    return NextResponse.json(
      { error: "Failed to build receipt" },
      { status: 500, headers: rateLimit.headers },
    );
  }

  const body = new Blob([new Uint8Array(buffer)], { type: "application/vnd.apple.pkpass" });
  return new NextResponse(body, {
    status: 200,
    headers: {
      ...rateLimit.headers,
      "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": `attachment; filename="${org.slug}-donation-${donationId}.pkpass"`,
      "Cache-Control": "no-store",
    },
  });
}
