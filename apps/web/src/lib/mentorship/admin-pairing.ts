import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  suggestMentorsForPairing,
  type AdminPairingCandidate,
} from "@/lib/mentorship/ai-suggestions";
import type { MentorshipSignal } from "@/lib/mentorship/matching";
import { ensureDirectChatGroup } from "@/lib/chat/direct-chat";

/**
 * Outcome of {@link executeAdminPairing}. `ok: false` carries an `httpStatus`
 * so the candidates route can surface the same response it always has; the AI
 * confirm handler maps it onto its pending-action rollback.
 */
export type AdminPairingOutcome =
  | {
      ok: true;
      pairId: string;
      /** True DB status of the pair: "accepted" (full success) or "proposed". */
      status: string;
      /** Authoritative raw match score persisted for the pair. */
      matchScore: number;
      confidence: number;
      /** Set when accept failed and the pair is left in "proposed". */
      warning?: string;
    }
  | {
      ok: false;
      code: "ineligible" | "exists" | "propose_failed";
      error: string;
      httpStatus: number;
    };

export interface ExecuteAdminPairingParams {
  organizationId: string;
  menteeUserId: string;
  mentorUserId: string;
  /** The acting admin's user id — recorded as the proposer and in the audit log. */
  actorUserId: string;
}

/**
 * Shared "propose + accept a mentorship pair as an admin" routine, used by both
 * the admin pairing board route (`POST .../mentorship/admin/candidates`) and the
 * AI `create_mentorship_pairing` pending-action executor.
 *
 * Re-ranks server-side so the match score/signals are authoritative (never
 * trusts a client-supplied score), idempotently proposes via `admin_propose_pair`,
 * then accepts with `admin_override`. The accept RPC relies on `auth.uid`, so the
 * caller passes a **user-scoped** `acceptClient` for the acting admin; everything
 * else runs on the `service` client.
 */
export async function executeAdminPairing(
  service: SupabaseClient<Database>,
  acceptClient: SupabaseClient<Database>,
  { organizationId, menteeUserId, mentorUserId, actorUserId }: ExecuteAdminPairingParams
): Promise<AdminPairingOutcome> {
  // Recompute server-side so match_score / match_signals are authoritative.
  const ranking = await suggestMentorsForPairing(service, organizationId, {
    menteeUserId,
    limit: 50,
  });
  const candidate: AdminPairingCandidate | undefined = ranking.candidates.find(
    (c) => c.mentor.user_id === mentorUserId
  );
  if (!candidate) {
    return {
      ok: false,
      code: "ineligible",
      error: "Mentor is no longer an eligible candidate (capacity or already paired)",
      httpStatus: 409,
    };
  }

  const matchSignals: MentorshipSignal[] = candidate.reasons.map((r) => ({
    code: r.code,
    weight: r.weight,
    value: r.value,
  }));

  const svc = service as unknown as {
    rpc: (
      fn: string,
      params: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
    from: (t: string) => { insert: (v: unknown) => Promise<{ error: { message: string } | null }> };
  };

  // 1) Propose (idempotent) via the shared RPC.
  const { data: rpcData, error: rpcError } = await svc.rpc("admin_propose_pair", {
    p_organization_id: organizationId,
    p_mentor_user_id: mentorUserId,
    p_mentee_user_id: menteeUserId,
    p_match_score: candidate.score,
    p_match_signals: matchSignals,
    p_actor_user_id: actorUserId,
  });

  if (rpcError && rpcError.code !== "23505") {
    return {
      ok: false,
      code: "propose_failed",
      error: rpcError.message ?? "Failed to propose pair",
      httpStatus: 500,
    };
  }
  const rpcRow = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
    | { pair_id?: string; reused?: boolean }
    | null;
  const pairId = rpcRow?.pair_id;
  if (!pairId) {
    return { ok: false, code: "exists", error: "Pairing already exists", httpStatus: 409 };
  }

  // 2) Admin-authoritative accept (user-scoped client supplies auth.uid). The
  // RPC returns the resulting row; surface its true status rather than a guess.
  const { data: acceptData, error: acceptError } = await acceptClient.rpc(
    "accept_mentorship_proposal",
    { pair_id: pairId, admin_override: true }
  );
  if (acceptError) {
    // Pair exists as proposed; report partial success so the admin can retry accept.
    return {
      ok: true,
      pairId,
      status: "proposed",
      matchScore: candidate.score,
      confidence: candidate.confidence,
      warning: acceptError.message,
    };
  }

  // Chat bootstrap (idempotent, non-blocking) — parity with the accept path.
  const chat = await ensureDirectChatGroup(service, {
    userAId: mentorUserId,
    userBId: menteeUserId,
    orgId: organizationId,
  });

  try {
    await svc.from("mentorship_audit_log").insert({
      organization_id: organizationId,
      actor_user_id: actorUserId,
      kind: "admin_matched",
      pair_id: pairId,
      metadata: {
        match_score: candidate.score,
        confidence: candidate.confidence,
        source: "admin_pairing_surface",
        chat_ok: chat.ok,
      },
    });
  } catch {
    // audit failures are non-fatal
  }

  const acceptedRow = (Array.isArray(acceptData) ? acceptData[0] : acceptData) as
    | { status?: string }
    | null;
  return {
    ok: true,
    pairId,
    status: acceptedRow?.status ?? "accepted",
    matchScore: candidate.score,
    confidence: candidate.confidence,
  };
}
