"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Button, Badge, Spinner, EmptyState } from "@/components/ui";

type Segment =
  | "linkedEligible"
  | "linkedNotEligible"
  | "unclaimedWithEmail"
  | "unclaimedNoEmail";

interface CohortEntry {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  segment: Segment | "softDeleted";
  last_invite_sent_at: string | null;
  invite_count: number;
}

interface ReInviteResult {
  alumniId: string;
  status: "sent" | "skipped" | "failed";
  reason?: string;
}

interface ReInviteResponse {
  sent: number;
  skipped: number;
  failed: number;
  results: ReInviteResult[];
}

// Display order + copy for the four live segments. Soft-deleted rows never
// reach the console (the API excludes them), so they aren't listed here.
const SEGMENT_META: { key: Segment; title: string; description: string }[] = [
  {
    key: "unclaimedWithEmail",
    title: "Unclaimed — has email",
    description: "Never claimed an account, but we have an email. Re-invitable.",
  },
  {
    key: "unclaimedNoEmail",
    title: "Unclaimed — no email",
    description: "Never claimed and no email on file. Structurally unreachable.",
  },
  {
    key: "linkedNotEligible",
    title: "Linked — can't chat",
    description: "Linked to a user, but without an active chat-eligible role.",
  },
  {
    key: "linkedEligible",
    title: "Reachable",
    description: "Linked and chat-eligible — fully reachable.",
  },
];

const COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

function fullName(entry: CohortEntry): string {
  const name = [entry.first_name, entry.last_name].filter(Boolean).join(" ").trim();
  return name || "(no name)";
}

function isOnCooldown(entry: CohortEntry, nowMs: number): boolean {
  if (!entry.last_invite_sent_at) return false;
  return nowMs - Date.parse(entry.last_invite_sent_at) < COOLDOWN_MS;
}

export function CohortConsoleClient({ organizationId }: { organizationId: string }) {
  const [entries, setEntries] = useState<CohortEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSending, setIsSending] = useState(false);
  const [lastResult, setLastResult] = useState<ReInviteResponse | null>(null);
  // Set once on mount to keep cooldown checks stable across renders.
  const [nowMs] = useState(() => Date.now());

  const loadCohorts = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/organizations/${organizationId}/alumni/cohorts`);
      if (!res.ok) {
        setLoadError("Unable to load alumni cohorts.");
        return;
      }
      const data = (await res.json()) as { entries: CohortEntry[] };
      setEntries(data.entries ?? []);
    } catch {
      setLoadError("Unable to load alumni cohorts.");
    } finally {
      setIsLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void loadCohorts();
  }, [loadCohorts]);

  const grouped = useMemo(() => {
    const map = new Map<Segment, CohortEntry[]>();
    for (const meta of SEGMENT_META) map.set(meta.key, []);
    for (const entry of entries) {
      const bucket = map.get(entry.segment as Segment);
      if (bucket) bucket.push(entry);
    }
    return map;
  }, [entries]);

  // Only unclaimed-with-email rows that are off cooldown can actually be sent.
  const selectableIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of entries) {
      if (entry.segment === "unclaimedWithEmail" && !isOnCooldown(entry, nowMs)) {
        ids.add(entry.id);
      }
    }
    return ids;
  }, [entries, nowMs]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sendReInvites = async () => {
    if (selectedIds.size === 0) return;
    setIsSending(true);
    setLastResult(null);
    try {
      const res = await fetch(`/api/organizations/${organizationId}/alumni/re-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alumniIds: [...selectedIds] }),
      });
      if (!res.ok) {
        setLastResult({ sent: 0, skipped: 0, failed: selectedIds.size, results: [] });
        return;
      }
      const data = (await res.json()) as ReInviteResponse;
      setLastResult(data);
      setSelectedIds(new Set());
      // Refresh so cooldown stamps + counters reflect the send.
      await loadCohorts();
    } catch {
      setLastResult({ sent: 0, skipped: 0, failed: selectedIds.size, results: [] });
    } finally {
      setIsSending(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="p-8">
        <div className="flex items-center justify-center">
          <Spinner />
        </div>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card className="p-6">
        <p className="text-sm text-red-600">{loadError}</p>
        <Button className="mt-3" variant="secondary" onClick={() => void loadCohorts()}>
          Retry
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {lastResult && (
        <div className="rounded-lg bg-green-50 p-3 text-sm text-green-800">
          Sent {lastResult.sent} · skipped {lastResult.skipped} · failed {lastResult.failed}
        </div>
      )}

      {SEGMENT_META.map((meta) => {
        const rows = grouped.get(meta.key) ?? [];
        const isReInvitable = meta.key === "unclaimedWithEmail";
        return (
          <Card key={meta.key} className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">{meta.title}</h2>
                <p className="text-xs text-gray-500">{meta.description}</p>
              </div>
              <Badge>{rows.length}</Badge>
            </div>

            {rows.length === 0 ? (
              <EmptyState title="No alumni in this segment" />
            ) : (
              <ul className="divide-y divide-gray-100">
                {rows.map((entry) => {
                  const cooled = isReInvitable && isOnCooldown(entry, nowMs);
                  const selectable = selectableIds.has(entry.id);
                  return (
                    <li
                      key={entry.id}
                      className="flex items-center justify-between gap-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-3">
                        {isReInvitable && (
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            disabled={!selectable}
                            checked={selectedIds.has(entry.id)}
                            onChange={() => toggle(entry.id)}
                            aria-label={`Select ${fullName(entry)}`}
                          />
                        )}
                        <div>
                          <span className="font-medium text-gray-900">{fullName(entry)}</span>
                          {entry.email && (
                            <span className="ml-2 text-gray-500">{entry.email}</span>
                          )}
                        </div>
                      </div>
                      {isReInvitable && (
                        <span className="text-xs text-gray-400">
                          {cooled
                            ? "On cooldown"
                            : entry.invite_count > 0
                              ? `Invited ${entry.invite_count}×`
                              : "Not yet invited"}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        );
      })}

      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-xl">
          <span className="text-sm font-medium text-gray-900">
            {selectedIds.size} selected
          </span>
          <div className="h-4 w-px bg-gray-200" />
          <Button onClick={() => void sendReInvites()} isLoading={isSending}>
            Re-invite selected ({selectedIds.size})
          </Button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-gray-500 hover:text-gray-900"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
