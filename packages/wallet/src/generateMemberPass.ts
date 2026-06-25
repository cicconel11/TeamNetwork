import { PKPass } from "passkit-generator";
import { ICON_PNG_BASE64 } from "./templates";

export type WalletCertificates = {
  wwdr: string | Buffer;
  signerCert: string | Buffer;
  signerKey: string | Buffer;
  signerKeyPassphrase?: string;
};

export type MemberPassInput = {
  passTypeIdentifier: string;
  teamIdentifier: string;
  organizationName: string;
  organizationSlug: string;
  memberId: string;
  memberDisplayName: string;
  memberRole?: string;
  qrPayload: string;
  certificates: WalletCertificates;
};

export type EventTicketPassInput = {
  passTypeIdentifier: string;
  teamIdentifier: string;
  organizationName: string;
  organizationSlug: string;
  eventId: string;
  eventTitle: string;
  eventStartIso: string;
  eventLocation?: string;
  attendeeId: string;
  attendeeDisplayName: string;
  qrPayload: string;
  certificates: WalletCertificates;
};

export type DonationReceiptPassInput = {
  passTypeIdentifier: string;
  teamIdentifier: string;
  organizationName: string;
  organizationSlug: string;
  donationId: string;
  amountFormatted: string;
  donorName: string;
  donatedAtIso: string;
  purpose?: string;
  certificates: WalletCertificates;
};

// icon.png and icon@2x.png are byte-identical, so one decoded buffer backs both
// required asset keys. Embedded (see ./templates) rather than read from disk so
// generation never depends on the bundler preserving the template files.
const ICON_BUFFER = Buffer.from(ICON_PNG_BASE64, "base64");

function loadSharedTemplateBuffers(): Record<string, Buffer> {
  return { "icon.png": ICON_BUFFER, "icon@2x.png": ICON_BUFFER };
}

function buildAndSerialize(
  passJson: Record<string, unknown>,
  templateBuffers: Record<string, Buffer>,
  certificates: WalletCertificates,
): Buffer {
  const pass = new PKPass(
    {
      ...templateBuffers,
      "pass.json": Buffer.from(JSON.stringify(passJson), "utf8"),
    },
    certificates,
  );
  return pass.getAsBuffer();
}

/**
 * Builds a signed Apple Wallet `storeCard` pass for an organization member.
 *
 * The QR code's encoded message is `qrPayload` — callers should sign or
 * otherwise scope this so a leaked pass cannot be replayed.
 */
export async function generateMemberPass(input: MemberPassInput): Promise<Buffer> {
  const templateBuffers = loadSharedTemplateBuffers();

  const passJson: Record<string, unknown> = {
    formatVersion: 1,
    passTypeIdentifier: input.passTypeIdentifier,
    teamIdentifier: input.teamIdentifier,
    organizationName: input.organizationName,
    description: `${input.organizationName} Member Card`,
    serialNumber: `${input.organizationSlug}.${input.memberId}`,
    foregroundColor: "rgb(255, 255, 255)",
    backgroundColor: "rgb(15, 23, 42)",
    labelColor: "rgb(148, 163, 184)",
    storeCard: {
      primaryFields: [
        { key: "member", label: "MEMBER", value: input.memberDisplayName },
      ],
      secondaryFields: input.memberRole
        ? [{ key: "role", label: "ROLE", value: input.memberRole }]
        : [],
      auxiliaryFields: [
        {
          key: "organization",
          label: "ORGANIZATION",
          value: input.organizationName,
        },
      ],
      backFields: [
        {
          key: "support",
          label: "Support",
          value:
            "Questions about this card? Contact your organization administrator.",
        },
      ],
    },
    barcodes: [
      {
        format: "PKBarcodeFormatQR",
        message: input.qrPayload,
        messageEncoding: "iso-8859-1",
        altText: input.memberDisplayName,
      },
    ],
  };

  return buildAndSerialize(passJson, templateBuffers, input.certificates);
}

/**
 * Builds a signed `eventTicket` pass for a single attendee + event. The pass
 * is `relevantDate`-stamped so Wallet surfaces it on the user's lock screen
 * around the event start time.
 */
export async function generateEventTicketPass(
  input: EventTicketPassInput,
): Promise<Buffer> {
  const templateBuffers = loadSharedTemplateBuffers();

  const passJson: Record<string, unknown> = {
    formatVersion: 1,
    passTypeIdentifier: input.passTypeIdentifier,
    teamIdentifier: input.teamIdentifier,
    organizationName: input.organizationName,
    description: `${input.organizationName} — ${input.eventTitle}`,
    serialNumber: `${input.organizationSlug}.event.${input.eventId}.${input.attendeeId}`,
    foregroundColor: "rgb(255, 255, 255)",
    backgroundColor: "rgb(15, 23, 42)",
    labelColor: "rgb(148, 163, 184)",
    relevantDate: input.eventStartIso,
    eventTicket: {
      primaryFields: [
        { key: "event", label: "EVENT", value: input.eventTitle },
      ],
      secondaryFields: [
        {
          key: "start",
          label: "STARTS",
          value: input.eventStartIso,
          dateStyle: "PKDateStyleMedium",
          timeStyle: "PKDateStyleShort",
        },
        ...(input.eventLocation
          ? [{ key: "location", label: "LOCATION", value: input.eventLocation }]
          : []),
      ],
      auxiliaryFields: [
        { key: "attendee", label: "ATTENDEE", value: input.attendeeDisplayName },
      ],
      backFields: [
        {
          key: "support",
          label: "Support",
          value:
            "Show this ticket at check-in. For questions, contact your organization administrator.",
        },
      ],
    },
    barcodes: [
      {
        format: "PKBarcodeFormatQR",
        message: input.qrPayload,
        messageEncoding: "iso-8859-1",
        altText: input.eventTitle,
      },
    ],
  };

  return buildAndSerialize(passJson, templateBuffers, input.certificates);
}

/**
 * Builds a signed `generic` pass that acts as a donation receipt. Includes a
 * tax-deductibility disclaimer; the org is responsible for issuing the
 * authoritative tax document separately.
 */
export async function generateDonationReceiptPass(
  input: DonationReceiptPassInput,
): Promise<Buffer> {
  const templateBuffers = loadSharedTemplateBuffers();

  const passJson: Record<string, unknown> = {
    formatVersion: 1,
    passTypeIdentifier: input.passTypeIdentifier,
    teamIdentifier: input.teamIdentifier,
    organizationName: input.organizationName,
    description: `Contribution receipt — ${input.organizationName}`,
    serialNumber: `${input.organizationSlug}.donation.${input.donationId}`,
    foregroundColor: "rgb(255, 255, 255)",
    backgroundColor: "rgb(15, 23, 42)",
    labelColor: "rgb(148, 163, 184)",
    generic: {
      primaryFields: [
        { key: "amount", label: "CONTRIBUTION", value: input.amountFormatted },
      ],
      secondaryFields: [
        { key: "donor", label: "SUPPORTER", value: input.donorName },
        ...(input.purpose
          ? [{ key: "purpose", label: "PURPOSE", value: input.purpose }]
          : []),
      ],
      auxiliaryFields: [
        {
          key: "donated_at",
          label: "DATE",
          value: input.donatedAtIso,
          dateStyle: "PKDateStyleMedium",
          timeStyle: "PKDateStyleNone",
        },
      ],
      backFields: [
        {
          key: "disclaimer",
          label: "Receipt note",
          value:
            "This pass is a record of your contribution to support the team and is not an official tax receipt.",
        },
        {
          key: "support",
          label: "Support",
          value:
            "Questions about this contribution? Contact your organization administrator.",
        },
      ],
    },
  };

  return buildAndSerialize(passJson, templateBuffers, input.certificates);
}
