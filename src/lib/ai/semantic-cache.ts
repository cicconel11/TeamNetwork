import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CACHE_VERSION,
  getCacheExpiresAt,
  type CacheSurface,
} from "./semantic-cache-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CacheHitType = "exact" | "semantic";

export type CacheHit = Readonly<{
  id: string;
  responseContent: string;
  hitType: CacheHitType;
  cachedAt: string;
}>;

export type CacheLookupResult =
  | { readonly ok: true; readonly hit: CacheHit }
  | { readonly ok: false; readonly reason: "miss" | "disabled" | "error" };

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export async function lookupSemanticCache(params: {
  normalizedPrompt: string;
  promptHash: string;
  orgId: string;
  surface: CacheSurface;
  permissionScopeKey: string;
  supabase: SupabaseClient;
}): Promise<CacheLookupResult> {
  const { promptHash, orgId, surface, permissionScopeKey, supabase } = params;

  const { data, error } = await (supabase as any)
    .from("ai_semantic_cache")
    .select("id, response_content, created_at")
    .eq("org_id", orgId)
    .eq("surface", surface)
    .eq("permission_scope_key", permissionScopeKey)
    .eq("cache_version", CACHE_VERSION)
    .eq("prompt_hash", promptHash)
    .is("invalidated_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    console.error("[ai-cache] lookup failed:", error);
    return { ok: false, reason: "error" };
  }

  if (data === null) {
    return { ok: false, reason: "miss" };
  }

  return {
    ok: true,
    hit: {
      id: data.id as string,
      responseContent: data.response_content as string,
      hitType: "exact",
      cachedAt: data.created_at as string,
    },
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

const MAX_RESPONSE_CONTENT_LENGTH = 16000;
const UNIQUE_VIOLATION_CODE = "23505";

export async function writeCacheEntry(params: {
  normalizedPrompt: string;
  promptHash: string;
  responseContent: string;
  orgId: string;
  surface: CacheSurface;
  permissionScopeKey: string;
  sourceMessageId: string;
  supabase: SupabaseClient;
}): Promise<void> {
  const {
    normalizedPrompt,
    promptHash,
    responseContent,
    orgId,
    surface,
    permissionScopeKey,
    sourceMessageId,
    supabase,
  } = params;

  if (responseContent.length > MAX_RESPONSE_CONTENT_LENGTH) {
    console.error("[ai-cache] response too large, skipping write");
    return;
  }

  const row = {
    org_id: orgId,
    surface,
    permission_scope_key: permissionScopeKey,
    cache_version: CACHE_VERSION,
    prompt_normalized: normalizedPrompt,
    prompt_hash: promptHash,
    response_content: responseContent,
    source_message_id: sourceMessageId,
    expires_at: getCacheExpiresAt(surface),
  };

  const { error } = await (supabase as any)
    .from("ai_semantic_cache")
    .insert(row);

  if (error) {
    if (error.code === UNIQUE_VIOLATION_CODE) {
      // Row already exists — this is expected on concurrent requests, not a failure
      console.error("[ai-cache] duplicate entry, skipping write:", error.message);
      return;
    }
    console.error("[ai-cache] write failed:", error);
  }
}
