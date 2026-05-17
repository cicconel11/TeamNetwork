import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PKPass } from "passkit-generator";

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

const TEMPLATE_DIR_FROM_PACKAGE = "../templates/member";

async function loadTemplateBuffers(): Promise<Record<string, Buffer>> {
  const here = dirname(fileURLToPath(import.meta.url));
  const templateDir = join(here, TEMPLATE_DIR_FROM_PACKAGE);
  const filenames = ["icon.png", "icon@2x.png"];
  const entries = await Promise.all(
    filenames.map(async (name) => [name, await readFile(join(templateDir, name))] as const),
  );
  return Object.fromEntries(entries);
}

/**
 * Builds a signed Apple Wallet `storeCard` pass for an organization member.
 *
 * The QR code's encoded message is `qrPayload` — callers should sign or
 * otherwise scope this so a leaked pass cannot be replayed. The pass does
 * not include a `webServiceURL`, so it will not auto-update; that requires
 * implementing the PassKit web service endpoints (Phase 4).
 */
export async function generateMemberPass(input: MemberPassInput): Promise<Buffer> {
  const templateBuffers = await loadTemplateBuffers();

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
        {
          key: "member",
          label: "MEMBER",
          value: input.memberDisplayName,
        },
      ],
      secondaryFields: input.memberRole
        ? [
            {
              key: "role",
              label: "ROLE",
              value: input.memberRole,
            },
          ]
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

  const pass = new PKPass(
    {
      ...templateBuffers,
      "pass.json": Buffer.from(JSON.stringify(passJson), "utf8"),
    },
    input.certificates,
  );

  return pass.getAsBuffer();
}
