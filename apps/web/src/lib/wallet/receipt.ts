import { NextResponse } from "next/server";
import { generateDonationReceiptPass } from "@teammeet/wallet";

type PassEnv = {
  passTypeIdentifier: string;
  teamIdentifier: string;
  wwdr: string;
  signerCert: string;
  signerKey: string;
  signerKeyPassphrase: string | undefined;
};

export function readReceiptPassEnv(): PassEnv | null {
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

export function formatDonationAmount(amountCents: number, currency: string): string {
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

export type DonationRow = {
  id: string;
  amount_cents: number;
  currency: string;
  donor_name: string | null;
  purpose: string | null;
  created_at: string;
  anonymous: boolean;
};

export type OrgRow = { name: string; slug: string };

/**
 * Generates a donation-receipt .pkpass response. Caller is responsible for
 * authorization (donor email match, org admin, signed token, etc.) and for
 * ensuring `donation.status === "succeeded"` before invoking.
 */
export async function buildReceiptResponse(args: {
  donation: DonationRow;
  org: OrgRow;
  rateLimitHeaders: Record<string, string>;
}): Promise<NextResponse> {
  const { donation, org, rateLimitHeaders } = args;

  const passEnv = readReceiptPassEnv();
  if (!passEnv) {
    return NextResponse.json(
      { error: "Apple Wallet receipts are not configured for this deployment." },
      { status: 503, headers: rateLimitHeaders },
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
      donationId: donation.id,
      amountFormatted: formatDonationAmount(donation.amount_cents, donation.currency),
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
      { status: 500, headers: rateLimitHeaders },
    );
  }

  const body = new Blob([new Uint8Array(buffer)], { type: "application/vnd.apple.pkpass" });
  return new NextResponse(body, {
    status: 200,
    headers: {
      ...rateLimitHeaders,
      "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": `attachment; filename="${org.slug}-donation-${donation.id}.pkpass"`,
      "Cache-Control": "no-store",
    },
  });
}
