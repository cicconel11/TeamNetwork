"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge, Button, Card, EmptyState } from "@/components/ui";

interface MenteeOption {
  user_id: string;
  name: string;
}

interface CandidateReason {
  code: string;
  label: string;
  explanation: string;
}

interface Candidate {
  mentor: { user_id: string; name: string; subtitle: string | null };
  score: number;
  confidence: number;
  confidenceLabel: "High" | "Good" | "Moderate" | "Low";
  capacityRemaining: number;
  isFallback: boolean;
  reasons: CandidateReason[];
  why: string;
}

interface CandidatesResponse {
  mentee: { user_id: string; name: string } | null;
  usedFallback: boolean;
  candidates: Candidate[];
}

interface AdminPairingBoardProps {
  orgId: string;
  mentees: MenteeOption[];
}

export function AdminPairingBoard({ orgId, mentees }: AdminPairingBoardProps) {
  const router = useRouter();
  const [menteeId, setMenteeId] = useState<string>("");
  const [data, setData] = useState<CandidatesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pairedIds, setPairedIds] = useState<Set<string>>(new Set());

  const loadCandidates = useCallback(
    async (selectedMenteeId: string) => {
      setData(null);
      setPairedIds(new Set());
      if (!selectedMenteeId) return;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/organizations/${orgId}/mentorship/admin/candidates?mentee_user_id=${selectedMenteeId}&limit=5`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          toast.error("Couldn't load mentor candidates.");
          setData({ mentee: null, usedFallback: false, candidates: [] });
          return;
        }
        setData((await res.json()) as CandidatesResponse);
      } catch {
        toast.error("Couldn't load mentor candidates.");
        setData({ mentee: null, usedFallback: false, candidates: [] });
      } finally {
        setLoading(false);
      }
    },
    [orgId]
  );

  const confirmPairing = useCallback(
    async (mentorUserId: string) => {
      if (!menteeId) return;
      setConfirmingId(mentorUserId);
      try {
        const res = await fetch(
          `/api/organizations/${orgId}/mentorship/admin/candidates`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mentee_user_id: menteeId, mentor_user_id: mentorUserId }),
          }
        );
        const body = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
        if (!res.ok) {
          toast.error(body.error ?? "Couldn't confirm the pairing.");
          return;
        }
        setPairedIds((prev) => new Set(prev).add(mentorUserId));
        // Anything past "proposed" (accepted/active) is a live mentorship.
        toast.success(
          body.status && body.status !== "proposed"
            ? "Pairing confirmed."
            : "Proposed to mentor."
        );
        router.refresh();
      } catch {
        toast.error("Couldn't confirm the pairing.");
      } finally {
        setConfirmingId(null);
      }
    },
    [menteeId, orgId, router]
  );

  return (
    <div className="space-y-6">
      <div className="max-w-md">
        <label htmlFor="mentee-select" className="block text-sm font-medium text-foreground mb-1">
          Student
        </label>
        <select
          id="mentee-select"
          value={menteeId}
          onChange={(e) => {
            setMenteeId(e.target.value);
            void loadCandidates(e.target.value);
          }}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Select a student…</option>
          {mentees.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Finding the best mentors…</p>}

      {data && !loading && data.candidates.length === 0 && (
        <EmptyState
          title="No mentors available"
          description="There are no alumni with open capacity to match right now."
        />
      )}

      {data && data.usedFallback && data.candidates.length > 0 && (
        <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          This student hasn&apos;t shared much yet, so these are general suggestions while we
          learn more about them. Encourage them to fill in their mentorship goals for sharper matches.
        </div>
      )}

      <div className="space-y-4">
        {data?.candidates.map((c) => {
          const paired = pairedIds.has(c.mentor.user_id);
          return (
            <Card key={c.mentor.user_id} padding="md">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground truncate">{c.mentor.name}</h3>
                    {c.isFallback && <Badge variant="muted">Suggested</Badge>}
                    <Badge variant="primary">
                      Confidence {c.confidence}/100 · {c.confidenceLabel}
                    </Badge>
                    <Badge variant={c.capacityRemaining > 0 ? "success" : "warning"}>
                      {c.capacityRemaining} {c.capacityRemaining === 1 ? "slot" : "slots"} open
                    </Badge>
                  </div>
                  {c.mentor.subtitle && (
                    <p className="text-sm text-muted-foreground truncate">{c.mentor.subtitle}</p>
                  )}
                </div>
                <Button
                  onClick={() => void confirmPairing(c.mentor.user_id)}
                  disabled={paired || confirmingId === c.mentor.user_id}
                >
                  {paired
                    ? "Paired"
                    : confirmingId === c.mentor.user_id
                      ? "Confirming…"
                      : "Confirm pairing"}
                </Button>
              </div>

              {c.why && <p className="mt-3 text-sm text-foreground">{c.why}</p>}

              {c.reasons.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {c.reasons.map((r, i) => (
                    <span
                      key={`${r.code}-${i}`}
                      title={r.explanation}
                      className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
                    >
                      {r.label}
                    </span>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
