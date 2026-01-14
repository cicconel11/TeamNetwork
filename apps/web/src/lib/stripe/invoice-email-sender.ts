import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { resolveAdminsForSubscription } from "@/lib/stripe/billing-admin-resolver";
import type { sendEmail } from "@/lib/notifications";

interface EmailTemplate {
  subject: string;
  body: string;
}

/**
 * Sends an invoice-related email to all billing admins for a subscription.
 * Returns true if emails were sent, false if no admins were found.
 */
export async function sendInvoiceEmailToAdmins(
  supabase: SupabaseClient<Database>,
  subscriptionId: string,
  eventLabel: string,
  buildTemplate: (entityName: string) => EmailTemplate,
  sendEmailFn: typeof sendEmail
): Promise<boolean> {
  const admins = await resolveAdminsForSubscription(supabase, subscriptionId);
  if (!admins) return false;

  const template = buildTemplate(admins.entityName);
  const results = await Promise.allSettled(
    admins.adminEmails.map((email) =>
      sendEmailFn({ to: email, subject: template.subject, body: template.body })
    )
  );

  for (const r of results) {
    if (r.status === "rejected") {
      console.error(`[stripe-webhook] Failed to send ${eventLabel}:`, r.reason);
    } else if (!r.value.success) {
      console.error(`[stripe-webhook] ${eventLabel} send error:`, r.value.error);
    }
  }

  return true;
}
