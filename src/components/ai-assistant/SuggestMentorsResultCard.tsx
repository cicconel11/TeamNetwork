"use client";

import { useState } from "react";

interface MentorSuggestion {
  mentor: {
    user_id: string;
    name: string;
    subtitle: string | null;
  };
  score: number;
  reasons: Array<{
    code: string;
    label: string;
    weight: number;
    value?: string | number;
  }>;
}

interface SuggestMentorsResultCardProps {
  mentee: { name: string } | null;
  suggestions: MentorSuggestion[];
  organizationId: string;
}

export function SuggestMentorsResultCard({
  mentee,
  suggestions,
  organizationId,
}: SuggestMentorsResultCardProps) {
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRequestIntro(mentorUserId: string) {
    setBusyId(mentorUserId);
    setError(null);
    try {
      const res = await fetch(
        `/api/organizations/${organizationId}/mentorship/requests`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mentor_user_id: mentorUserId }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to send request");
      }
      setRequestedIds((prev) => new Set(prev).add(mentorUserId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send request");
    } finally {
      setBusyId(null);
    }
  }

  if (!mentee || suggestions.length === 0) return null;

  return (
    <div className="space-y-3 mt-2">
      {suggestions.map((s) => {
        const isRequested = requestedIds.has(s.mentor.user_id);
        const isBusy = busyId === s.mentor.user_id;

        return (
          <div
            key={s.mentor.user_id}
            className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm text-gray-900 dark:text-gray-100">
                  {s.mentor.name}
                </p>
                {s.mentor.subtitle && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {s.mentor.subtitle}
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={isRequested || isBusy}
                onClick={() => handleRequestIntro(s.mentor.user_id)}
                className={`shrink-0 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  isRequested
                    ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                    : "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                }`}
              >
                {isRequested ? "Request sent" : isBusy ? "Sending..." : "Request intro"}
              </button>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {s.reasons.map((r) => (
                <span
                  key={r.code}
                  className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                >
                  {r.label}
                  {r.value != null && r.value !== "" ? `: ${r.value}` : ""}
                </span>
              ))}
            </div>
          </div>
        );
      })}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
