import { buildInviteLink } from "@/lib/invites/buildInviteLink";
import type { NotificationResult, EmailParams } from "@/lib/notifications";

export interface BatchOrgInviteRecipient {
  email: string;
  role: "admin" | "active_member" | "alumni";
}

export interface BatchOrgInviteTarget {
  orgId: string;
  orgSlug: string;
  orgName: string;
  recipients: BatchOrgInviteRecipient[];
}

export interface BatchOrgInviteResult {
  orgSlug: string;
  email: string;
  role: "admin" | "active_member" | "alumni";
  status: "sent" | "failed" | "skipped";
  ok: boolean;
  code: string | null;
  link: string | null;
  error?: string;
}

interface InviteRecord {
  code: string;
  token?: string | null;
}

interface CreateInviteInput {
  orgId: string;
  role: "admin" | "active_member" | "alumni";
  uses: number;
}

interface CreateInviteResult {
  invite: InviteRecord | null;
  error?: string;
}

interface SendBatchOrgInvitesParams {
  baseUrl: string;
  emailDeliveryEnabled: boolean;
  targets: BatchOrgInviteTarget[];
  createInvite: (input: CreateInviteInput) => Promise<CreateInviteResult>;
  sendEmailFn: (params: EmailParams) => Promise<NotificationResult>;
  concurrency?: number;
}

function buildInviteEmail(orgName: string, link: string, code: string) {
  return {
    subject: `You're invited to join ${orgName}`,
    body: `You've been invited to join ${orgName}.\n\nJoin using this link: ${link}\n\nOr use invite code: ${code}`,
  };
}

function dedupeRecipients(recipients: BatchOrgInviteRecipient[]) {
  const seen = new Set<string>();
  const unique: BatchOrgInviteRecipient[] = [];

  for (const recipient of recipients) {
    const key = `${recipient.role}:${recipient.email.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      ...recipient,
      email: recipient.email.trim().toLowerCase(),
    });
  }

  return unique;
}

export async function sendBatchOrgInvites({
  baseUrl,
  emailDeliveryEnabled,
  targets,
  createInvite,
  sendEmailFn,
  concurrency = 10,
}: SendBatchOrgInvitesParams): Promise<BatchOrgInviteResult[]> {
  const results: BatchOrgInviteResult[] = [];

  for (const target of targets) {
    const recipients = dedupeRecipients(target.recipients);
    const recipientsByRole = new Map<
      BatchOrgInviteRecipient["role"],
      BatchOrgInviteRecipient[]
    >();

    for (const recipient of recipients) {
      const existing = recipientsByRole.get(recipient.role) ?? [];
      existing.push(recipient);
      recipientsByRole.set(recipient.role, existing);
    }

    for (const [role, roleRecipients] of recipientsByRole.entries()) {
      const inviteResult = await createInvite({
        orgId: target.orgId,
        role,
        uses: roleRecipients.length,
      });

      if (!inviteResult.invite) {
        for (const recipient of roleRecipients) {
          results.push({
            orgSlug: target.orgSlug,
            email: recipient.email,
            role,
            status: "failed",
            ok: false,
            code: null,
            link: null,
            error: inviteResult.error ?? "Failed to create invite",
          });
        }
        continue;
      }

      const link = buildInviteLink({
        kind: "org",
        baseUrl,
        orgId: target.orgId,
        code: inviteResult.invite.code,
        token: inviteResult.invite.token ?? undefined,
      });

      if (!emailDeliveryEnabled) {
        for (const recipient of roleRecipients) {
          results.push({
            orgSlug: target.orgSlug,
            email: recipient.email,
            role,
            status: "skipped",
            ok: true,
            code: inviteResult.invite.code,
            link,
          });
        }
        continue;
      }

      const emailTasks = roleRecipients.map(
        (recipient) => async (): Promise<BatchOrgInviteResult> => {
          const emailContent = buildInviteEmail(
            target.orgName,
            link,
            inviteResult.invite!.code
          );
          const delivery = await sendEmailFn({
            to: recipient.email,
            subject: emailContent.subject,
            body: emailContent.body,
          });

          return {
            orgSlug: target.orgSlug,
            email: recipient.email,
            role,
            status: delivery.success ? "sent" : "failed",
            ok: delivery.success,
            code: inviteResult.invite!.code,
            link,
            error: delivery.success ? undefined : delivery.error ?? "Email delivery failed",
          };
        }
      );

      for (let i = 0; i < emailTasks.length; i += concurrency) {
        const batch = emailTasks.slice(i, i + concurrency).map((task) => task());
        const batchResults = await Promise.allSettled(batch);

        for (let index = 0; index < batchResults.length; index++) {
          const batchResult = batchResults[index];
          if (batchResult.status === "fulfilled") {
            results.push(batchResult.value);
            continue;
          }

          const recipient = roleRecipients[i + index];
          results.push({
            orgSlug: target.orgSlug,
            email: recipient.email,
            role,
            status: "failed",
            ok: false,
            code: inviteResult.invite.code,
            link,
            error:
              batchResult.reason instanceof Error
                ? batchResult.reason.message
                : "Unexpected error",
          });
        }
      }
    }
  }

  return results;
}
