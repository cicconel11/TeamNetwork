import { z } from "zod";

/**
 * Public mailbox providers (and our own sending domain) can never be claimed
 * as an org's custom sending domain — orgs must own the domain's DNS.
 */
export const EMAIL_DOMAIN_DENY_LIST = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "zoho.com",
  "gmx.com",
  "mail.com",
  "myteamnetwork.com",
]);

// POSIX-safe (no non-capturing groups) so the same pattern works in Postgres CHECKs.
const HOSTNAME_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const LOCAL_PART_REGEX = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;

/** Strip characters that could break or spoof an RFC 5322 display name. */
export function sanitizeSenderDisplayName(name: string): string {
  return name.replace(/["<>\r\n]/g, "").trim().slice(0, 120);
}

export const emailSendingDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(4, "Domain is too short")
  .max(253, "Domain is too long")
  .regex(HOSTNAME_REGEX, "Enter a valid domain like example.edu")
  .refine((domain) => !EMAIL_DOMAIN_DENY_LIST.has(domain), {
    message: "Public email providers can't be used — enter a domain your organization owns",
  });

export const emailDomainCreateSchema = z.object({
  domain: emailSendingDomainSchema,
  senderLocalPart: z
    .string()
    .trim()
    .toLowerCase()
    .max(64, "Sender name is too long")
    .regex(LOCAL_PART_REGEX, "Use lowercase letters, numbers, dots, dashes, or underscores")
    .optional(),
  senderDisplayName: z
    .string()
    .trim()
    .max(120, "Display name is too long")
    .transform(sanitizeSenderDisplayName)
    .optional(),
});

export const emailDomainUpdateSchema = z
  .object({
    senderLocalPart: z
      .string()
      .trim()
      .toLowerCase()
      .max(64, "Sender name is too long")
      .regex(LOCAL_PART_REGEX, "Use lowercase letters, numbers, dots, dashes, or underscores")
      .optional(),
    senderDisplayName: z
      .string()
      .trim()
      .max(120, "Display name is too long")
      .transform(sanitizeSenderDisplayName)
      .nullable()
      .optional(),
  })
  .refine(
    (value) => value.senderLocalPart !== undefined || value.senderDisplayName !== undefined,
    { message: "Nothing to update" }
  );

export type EmailDomainCreateInput = z.infer<typeof emailDomainCreateSchema>;
export type EmailDomainUpdateInput = z.infer<typeof emailDomainUpdateSchema>;
