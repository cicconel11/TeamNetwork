/**
 * AI scope discriminated union.
 *
 * The AI assistant operates at two scopes:
 *  - "org": tied to a single organization (existing surface)
 *  - "enterprise": tied to an enterprise tenant (Phase 1)
 *
 * Shared libs (thread-resolver, audit, context-builder) take an `AiScope`
 * argument so they can route to the correct foreign keys, RLS path, and
 * audit table without duplicating call sites.
 *
 * Tools and request handlers should NEVER accept LLM-supplied scope ids —
 * the scope is built once from server-validated context (`getAiOrgContext` or
 * `getEnterpriseAiContext`) and passed down explicitly.
 */
export type AiScope =
  | { scope: "org"; orgId: string }
  | { scope: "enterprise"; enterpriseId: string };

/** Narrow an AiScope to an org scope, throwing if it's enterprise. */
export function assertOrgScope(s: AiScope): { scope: "org"; orgId: string } {
  if (s.scope !== "org") {
    throw new Error(`expected org scope, got ${s.scope}`);
  }
  return s;
}

/** Narrow an AiScope to an enterprise scope, throwing if it's org. */
export function assertEnterpriseScope(
  s: AiScope
): { scope: "enterprise"; enterpriseId: string } {
  if (s.scope !== "enterprise") {
    throw new Error(`expected enterprise scope, got ${s.scope}`);
  }
  return s;
}

/** Stable id for the scope (org_id or enterprise_id). */
export function scopeId(s: AiScope): string {
  return s.scope === "org" ? s.orgId : s.enterpriseId;
}

/** Scope label for logs/telemetry. */
export function scopeLabel(s: AiScope): "org" | "enterprise" {
  return s.scope;
}

/**
 * Adapter — accept legacy `orgId: string` OR new `AiScope` and normalize to
 * `AiScope`. Used by libs whose tests still pass bare strings.
 */
export function toAiScope(input: string | AiScope): AiScope {
  if (typeof input === "string") {
    return { scope: "org", orgId: input };
  }
  return input;
}
