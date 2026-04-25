import type { MentorshipPair } from "@teammeet/types";

export const PROPOSAL_STATUSES = new Set(["proposed", "declined", "expired"]);

export type MentorshipPairRecord = MentorshipPair & {
  declined_reason?: string | null;
  proposed_at?: string | null;
  match_score?: number | null;
  match_signals?: unknown;
};

export type MatchSignal = {
  code?: string;
  kind?: string;
  weight?: number;
  value?: string | number;
  label?: string;
};

export function isProposalStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && PROPOSAL_STATUSES.has(status);
}

export function partitionMentorshipPairs<T extends { status: string | null | undefined }>(
  pairs: T[]
): { workingPairs: T[]; proposalPairs: T[] } {
  const workingPairs: T[] = [];
  const proposalPairs: T[] = [];

  pairs.forEach((pair) => {
    if (isProposalStatus(pair.status)) {
      proposalPairs.push(pair);
    } else {
      workingPairs.push(pair);
    }
  });

  return { workingPairs, proposalPairs };
}

export function canCreateMentorshipLog(params: {
  role: string | null | undefined;
  status: string | null | undefined;
}): boolean {
  return (
    params.status === "active" &&
    (params.role === "admin" || params.role === "active_member")
  );
}

const MATCH_SIGNAL_LABELS: Record<string, string> = {
  shared_sport: "Same sport",
  shared_position: "Same position",
  shared_topics: "Shared topics",
  shared_industry: "Same industry",
  shared_role_family: "Same role family",
  graduation_gap_fit: "Graduation gap fit",
  shared_city: "Same city",
  shared_company: "Same company",
};

export function pickMatchSignalCode(signal: unknown): string | null {
  if (!signal || typeof signal !== "object") return null;
  const value = signal as MatchSignal;
  if (typeof value.code === "string" && value.code.length > 0) return value.code;
  if (typeof value.kind === "string" && value.kind.length > 0) return value.kind;
  return null;
}

export function labelMatchSignal(code: string | null | undefined): string {
  if (!code) return "Match signal";
  return (
    MATCH_SIGNAL_LABELS[code] ??
    code
      .split("_")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}
