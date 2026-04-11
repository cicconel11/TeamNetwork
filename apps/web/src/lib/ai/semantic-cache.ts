/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getCacheExpiresAt,
  type CacheSurface,
  type SemanticCacheKeyParts,
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
  | { readonly ok: false; readonly reason: "miss" | "error" };

export type CacheWriteResult =
  | { readonly status: "inserted"; readonly entryId: string }
  | { readonly status: "duplicate" }
  | { readonly status: "skipped_too_large" }
  | { readonly status: "error" };

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export async function lookupSemanticCache(params: {
  cacheKey: Pick<SemanticCacheKeyParts, "promptHash" | "permissionScopeKey" | "cacheVersion">;
  orgId: string;
  surface: CacheSurface;
  supabase: SupabaseClient;
}): Promise<CacheLookupResult> {
  const { cacheKey, orgId, surface, supabase } = params;

  const { data, error } = await (supabase as any)
    .from("ai_semantic_cache")
    .select("id, response_content, created_at")
    .eq("org_id", orgId)
    .eq("surface", surface)
    .eq("permission_scope_key", cacheKey.permissionScopeKey)
    .eq("cache_version", cacheKey.cacheVersion)
    .eq("prompt_hash", cacheKey.promptHash)
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
  cacheKey: Pick<
    SemanticCacheKeyParts,
    "normalizedPrompt" | "promptHash" | "permissionScopeKey" | "cacheVersion"
  >;
  responseContent: string;
  orgId: string;
  surface: CacheSurface;
  sourceMessageId: string;
  supabase: SupabaseClient;
}): Promise<CacheWriteResult> {
  const {
    cacheKey,
    responseContent,
    orgId,
    surface,
    sourceMessageId,
    supabase,
  } = params;

  if (responseContent.length > MAX_RESPONSE_CONTENT_LENGTH) {
    console.error("[ai-cache] response too large, skipping write");
    return { status: "skipped_too_large" };
  }

  const nowIso = new Date().toISOString();

  await (supabase as any)
    .from("ai_semantic_cache")
    .update({
      invalidated_at: nowIso,
      invalidation_reason: "replaced_after_expiry",
    })
    .eq("org_id", orgId)
    .eq("surface", surface)
    .eq("permission_scope_key", cacheKey.permissionScopeKey)
    .eq("cache_version", cacheKey.cacheVersion)
    .eq("prompt_hash", cacheKey.promptHash)
    .is("invalidated_at", null)
    .lte("expires_at", nowIso);

  const row = {
    org_id: orgId,
    surface,
    permission_scope_key: cacheKey.permissionScopeKey,
    cache_version: cacheKey.cacheVersion,
    prompt_normalized: cacheKey.normalizedPrompt,
    prompt_hash: cacheKey.promptHash,
    response_content: responseContent,
    source_message_id: sourceMessageId,
    expires_at: getCacheExpiresAt(surface),
  };

  const { data, error } = await (supabase as any)
    .from("ai_semantic_cache")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION_CODE) {
      // Row already exists — this is expected on concurrent requests, not a failure.
      return { status: "duplicate" };
    }
    console.error("[ai-cache] write failed:", error);
    return { status: "error" };
  }

  if (!data?.id) {
    console.error("[ai-cache] write succeeded without returning an id");
    return { status: "error" };
  }

  return { status: "inserted", entryId: data.id as string };
}
