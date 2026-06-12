import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { sanitizeSenderDisplayName } from "@/lib/schemas/email-domain";

export const GLOBAL_FROM_EMAIL = process.env.FROM_EMAIL || "noreply@myteamnetwork.com";

export interface ResolvedSender {
  /** RFC 5322 from value, e.g. `Villanova Football <noreply@villanova.edu>`. */
  from: string;
  isCustomDomain: boolean;
}

const GLOBAL_SENDER: ResolvedSender = { from: GLOBAL_FROM_EMAIL, isCustomDomain: false };

const CACHE_TTL_MS = 60_000;
const senderCache = new Map<string, { value: ResolvedSender; expiresAt: number }>();

export function invalidateSenderCache(organizationId?: string): void {
  if (organizationId) {
    senderCache.delete(organizationId);
  } else {
    senderCache.clear();
  }
}

interface EmailDomainSenderRow {
  domain: string;
  sender_local_part: string;
  sender_display_name: string | null;
}

/**
 * Resolve the from address for an org's outbound email. Orgs with a verified
 * custom sending domain get `"Org Name" <localpart@domain>`; everyone else
 * gets the global sender. Requires a service-role client — the
 * organization_email_domains table is service-only under RLS, so an anon or
 * user-scoped client simply resolves to the global sender. Never throws.
 */
export async function resolveOrgSender(
  supabase: SupabaseClient<Database>,
  organizationId: string
): Promise<ResolvedSender> {
  const cached = senderCache.get(organizationId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  let resolved: ResolvedSender = GLOBAL_SENDER;
  try {
    // organization_email_domains is not in generated types until gen:types runs.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("organization_email_domains")
      .select("domain, sender_local_part, sender_display_name")
      .eq("organization_id", organizationId)
      .eq("status", "verified")
      .maybeSingle();

    if (!error && data) {
      const row = data as unknown as EmailDomainSenderRow;
      let displayName = sanitizeSenderDisplayName(row.sender_display_name ?? "");
      if (!displayName) {
        const { data: org } = await supabase
          .from("organizations")
          .select("name")
          .eq("id", organizationId)
          .maybeSingle();
        displayName = sanitizeSenderDisplayName(org?.name ?? "");
      }
      const address = `${row.sender_local_part}@${row.domain}`;
      resolved = {
        from: displayName ? `${displayName} <${address}>` : address,
        isCustomDomain: true,
      };
    }
  } catch (err) {
    console.warn("[resolveOrgSender] falling back to global sender:", err);
    // Don't cache transient failures — retry on the next call.
    return GLOBAL_SENDER;
  }

  senderCache.set(organizationId, { value: resolved, expiresAt: Date.now() + CACHE_TTL_MS });
  return resolved;
}
