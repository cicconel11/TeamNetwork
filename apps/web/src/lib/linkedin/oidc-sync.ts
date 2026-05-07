import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { User } from "@supabase/supabase-js";
import type { LinkedInProfile } from "@/lib/linkedin/oauth";
import { syncLinkedInProfileFields } from "@/lib/linkedin/oauth";
import { LINKEDIN_OIDC_PROVIDER } from "@/lib/linkedin/config";
import {
  LINKEDIN_OIDC_SOURCE,
  LINKEDIN_OIDC_TOKEN_SENTINEL,
} from "@/lib/linkedin/connection-source";
import { saveLinkedInUrlForUser } from "@/lib/linkedin/settings";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OidcSyncSuccess {
  synced: true;
}

interface OidcSyncSkipped {
  skipped: true;
}

interface OidcSyncError {
  synced: false;
  error: string;
}

export type OidcSyncResult = OidcSyncSuccess | OidcSyncSkipped | OidcSyncError;

type LinkedInMetadata = Record<string, unknown>;
type OidcSyncRunner = (
  supabase: SupabaseClient<Database>,
  user: User,
) => Promise<OidcSyncResult>;

// ---------------------------------------------------------------------------
// Profile extraction
// ---------------------------------------------------------------------------

/**
 * Extracts a LinkedInProfile from Supabase Auth user metadata.
 *
 * Reads fields from `user.identities` for a `linkedin_oidc` identity first,
 * then falls back field-by-field to `user.user_metadata`.
 */
export function extractLinkedInProfile(user: User): LinkedInProfile {
  const identity = user.identities?.find(
    (i) => i.provider === LINKEDIN_OIDC_PROVIDER,
  );
  const identityMeta = (identity?.identity_data ?? {}) as LinkedInMetadata;
  const userMeta = (user.user_metadata ?? {}) as LinkedInMetadata;

  const firstNonEmptyString = (...values: unknown[]): string => {
    for (const value of values) {
      if (typeof value === "string" && value.trim() !== "") {
        return value;
      }
    }
    return "";
  };

  const firstBoolean = (...values: unknown[]): boolean => {
    for (const value of values) {
      if (typeof value === "boolean") {
        return value;
      }
    }
    return false;
  };

  const givenName = firstNonEmptyString(
    identityMeta.given_name,
    userMeta.given_name,
  );
  const familyName = firstNonEmptyString(
    identityMeta.family_name,
    userMeta.family_name,
  );

  // Fallback: split `name` or `full_name` if given/family are absent
  const fullName = firstNonEmptyString(
    identityMeta.name,
    identityMeta.full_name,
    userMeta.name,
    userMeta.full_name,
  );
  const resolvedGivenName =
    givenName || fullName.split(" ").slice(0, 1).join("") || "";
  const resolvedFamilyName =
    familyName || fullName.split(" ").slice(1).join(" ") || "";

  return {
    sub: firstNonEmptyString(
      identityMeta.sub,
      identityMeta.provider_id,
      userMeta.sub,
      userMeta.provider_id,
    ),
    givenName: resolvedGivenName,
    familyName: resolvedFamilyName,
    email: firstNonEmptyString(identityMeta.email, userMeta.email, user.email),
    picture:
      firstNonEmptyString(
        identityMeta.picture,
        identityMeta.avatar_url,
        userMeta.picture,
        userMeta.avatar_url,
      ) || null,
    emailVerified: firstBoolean(
      identityMeta.email_verified,
      userMeta.email_verified,
    ),
  };
}

// ---------------------------------------------------------------------------
// OIDC connection storage (conditional — never overwrites real OAuth tokens)
// ---------------------------------------------------------------------------

/**
 * Stores a lightweight connection record for an OIDC login.
 *
 * Uses a check-then-act approach:
 * 1. Check if a connection row already exists
 * 2. If it exists with real OAuth tokens (non-OIDC source), skip — don't overwrite
 * 3. If it exists with OIDC source, update profile fields
 * 4. If no row exists, insert a new OIDC sentinel record
 */
export async function storeLinkedInOidcConnection(
  supabase: SupabaseClient<Database>,
  userId: string,
  profile: LinkedInProfile,
): Promise<{ success: boolean; error?: string }> {
  if (!profile.sub) {
    return { success: true };
  }

  const now = new Date().toISOString();
  const profileFields = {
    linkedin_sub: profile.sub,
    linkedin_email: profile.email || null,
    linkedin_name:
      [profile.givenName, profile.familyName].filter(Boolean).join(" ") ||
      null,
    linkedin_given_name: profile.givenName || null,
    linkedin_family_name: profile.familyName || null,
    linkedin_picture_url: profile.picture || null,
  };

  // Step 1: Check for existing connection
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing, error: selectError } = await (supabase as any)
    .from("user_linkedin_connections")
    .select("linkedin_data")
    .eq("user_id", userId)
    .maybeSingle();

  if (selectError) {
    console.error("[linkedin-oidc-sync] Failed to check existing connection:", selectError);
    return { success: false, error: selectError.message };
  }

  if (existing) {
    // Row exists — only update if it's also from OIDC (don't overwrite real OAuth tokens)
    const source = existing.linkedin_data?.source;
    if (source !== LINKEDIN_OIDC_SOURCE) {
      return { success: true };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (supabase as any)
      .from("user_linkedin_connections")
      .update({
        ...profileFields,
        last_synced_at: now,
        sync_error: null,
      })
      .eq("user_id", userId);

    if (updateError) {
      console.error("[linkedin-oidc-sync] Failed to update OIDC connection:", updateError);
      return { success: false, error: updateError.message };
    }

    return { success: true };
  }

  // No existing row — insert new OIDC sentinel record
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertError } = await (supabase as any)
    .from("user_linkedin_connections")
    .insert({
      user_id: userId,
      ...profileFields,
      access_token_encrypted: LINKEDIN_OIDC_TOKEN_SENTINEL,
      refresh_token_encrypted: null,
      token_expires_at: "1970-01-01T00:00:00.000Z",
      status: "connected",
      last_synced_at: now,
      sync_error: null,
      linkedin_data: { source: LINKEDIN_OIDC_SOURCE },
    });

  if (insertError) {
    console.error("[linkedin-oidc-sync] Failed to insert OIDC connection:", insertError);
    return { success: false, error: insertError.message };
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// LinkedIn URL lookup from org records
// ---------------------------------------------------------------------------

/**
 * Finds the most recently updated linkedin_url from the user's org records.
 * Queries members/alumni/parents ordered by updated_at DESC and returns the
 * URL with the globally most recent timestamp, preventing arbitrary cross-org
 * overwrites when records disagree.
 */
async function findExistingLinkedInUrl(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string | null> {
  const tables = ["members", "alumni", "parents"] as const;

  // Run all 3 queries in parallel — each returns { data, error } (never throws).
  const results = await Promise.all(
    tables.map((table) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from(table)
        .select("linkedin_url, updated_at")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .not("linkedin_url", "is", null)
        .order("updated_at", { ascending: false })
        .limit(2),
    ),
  );

  let bestUrl: string | null = null;
  let bestUpdatedAt: string | null = null;

  for (let i = 0; i < tables.length; i++) {
    const { data, error } = results[i];

    if (error) {
      console.error(`[linkedin-oidc-sync] Failed to read ${tables[i]} for linkedin_url lookup:`, error);
      return null;
    }

    // Intra-table ambiguity: 2 rows, same timestamp, different URLs
    if (
      data?.length === 2 &&
      data[0].updated_at === data[1].updated_at &&
      data[0].linkedin_url !== data[1].linkedin_url
    ) {
      return null;
    }

    const row = data?.[0];
    if (row?.linkedin_url) {
      const ts = row.updated_at ?? "";
      if (!bestUpdatedAt || ts > bestUpdatedAt) {
        bestUrl = row.linkedin_url;
        bestUpdatedAt = ts;
      } else if (ts === bestUpdatedAt && row.linkedin_url !== bestUrl) {
        // Same timestamp, different URL — ambiguous; skip propagation
        return null;
      }
    }
  }

  return bestUrl;
}

// ---------------------------------------------------------------------------
// Main sync entry point
// ---------------------------------------------------------------------------

/**
 * Syncs LinkedIn profile data to org records on OIDC login.
 *
 * This is the entry point called from the auth callback route.
 * It never throws — all errors are returned as structured results.
 */
export async function syncLinkedInOidcProfileOnLogin(
  supabase: SupabaseClient<Database>,
  user: User,
): Promise<OidcSyncResult> {
  const provider = user.app_metadata?.provider;
  if (provider !== LINKEDIN_OIDC_PROVIDER) {
    return { skipped: true };
  }

  const profile = extractLinkedInProfile(user);

  // Connection record first — prerequisite for Connected Accounts UI.
  // If this fails, skip profile sync entirely to avoid mixed state.
  const connectionResult = await storeLinkedInOidcConnection(supabase, user.id, profile);
  if (!connectionResult.success) {
    return { synced: false, error: connectionResult.error ?? "Failed to store OIDC connection" };
  }

  // Capture the most-recently-updated linkedin_url BEFORE profile sync
  // touches updated_at on all rows via the sync RPC.
  const existingUrl = await findExistingLinkedInUrl(supabase, user.id);

  // Profile fields second — only if connection row exists
  const syncResult = await syncLinkedInProfileFields(supabase, user.id, profile);

  if (!syncResult.success) {
    // updated_count === 0 means user hasn't joined any org yet — that's OK
    if (syncResult.error === "No profile found to update") {
      return { synced: true };
    }
    return { synced: false, error: syncResult.error };
  }

  // Best-effort: propagate linkedin_url from existing org records to all records.
  // Handles the case where the user set their URL in one org but not others.
  if (existingUrl) {
    const urlResult = await saveLinkedInUrlForUser(supabase, user.id, existingUrl);
    if (!urlResult.success && urlResult.reason !== "not_found") {
      console.error("[linkedin-oidc-sync] Failed to propagate linkedin_url:", urlResult.error);
    }
  }

  return { synced: true };
}

/**
 * Runs LinkedIn OIDC profile sync with error isolation.
 *
 * Callers may await this directly or schedule it as best-effort background
 * work, but this helper always swallows thrown errors and logs structured
 * non-success results so auth flows do not crash.
 */
export async function runLinkedInOidcSyncSafe(
  createSupabase: () => SupabaseClient<Database>,
  user: User,
  runSync: OidcSyncRunner = syncLinkedInOidcProfileOnLogin,
): Promise<void> {
  try {
    const result = await runSync(createSupabase(), user);
    if ("synced" in result && !result.synced) {
      console.error("[linkedin-oidc-sync] Login profile sync returned error:", result.error);
    }
  } catch (err) {
    console.error("[linkedin-oidc-sync] Login profile sync failed:", err);
  }
}
