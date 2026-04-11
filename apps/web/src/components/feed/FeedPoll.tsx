"use client";

import { useState, useCallback } from "react";
import type { PollMetadata } from "./types";

interface FeedPollProps {
  postId: string;
  meta: PollMetadata;
  userVote: number | null;
  voteCounts: number[];
  totalVotes: number;
}

export function FeedPoll({ postId, meta, userVote: initialVote, voteCounts: initialCounts, totalVotes: initialTotal }: FeedPollProps) {
  const [userVote, setUserVote] = useState<number | null>(initialVote);
  const [voteCounts, setVoteCounts] = useState<number[]>(initialCounts);
  const [totalVotes, setTotalVotes] = useState(initialTotal);
  const [isVoting, setIsVoting] = useState(false);

  const hasVoted = userVote !== null;

  const castVote = useCallback(async (optionIndex: number) => {
    if (isVoting) return;
    if (hasVoted && !meta.allow_change) return;
    if (userVote === optionIndex) return;

    setIsVoting(true);

    // Optimistic update
    const prevVote = userVote;
    const prevCounts = [...voteCounts];
    const prevTotal = totalVotes;

    const newCounts = [...voteCounts];
    if (prevVote !== null && prevVote < newCounts.length) {
      newCounts[prevVote] = Math.max(0, newCounts[prevVote] - 1);
    }
    if (optionIndex < newCounts.length) {
      newCounts[optionIndex]++;
    }
    const newTotal = prevVote !== null ? totalVotes : totalVotes + 1;

    setUserVote(optionIndex);
    setVoteCounts(newCounts);
    setTotalVotes(newTotal);

    try {
      const res = await fetch(`/api/feed/${postId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ option_index: optionIndex }),
      });

      if (!res.ok) {
        // Revert on failure
        setUserVote(prevVote);
        setVoteCounts(prevCounts);
        setTotalVotes(prevTotal);
      }
    } catch {
      setUserVote(prevVote);
      setVoteCounts(prevCounts);
      setTotalVotes(prevTotal);
    } finally {
      setIsVoting(false);
    }
  }, [isVoting, hasVoted, meta.allow_change, userVote, voteCounts, totalVotes, postId]);

  return (
    <div className="mt-3 space-y-2">
      {meta.question && <p className="text-sm font-semibold text-foreground">{meta.question}</p>}

      <div className="space-y-1.5">
        {meta.options.map((opt, i) => {
          const count = voteCounts[i] ?? 0;
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const isSelected = userVote === i;

          if (!hasVoted) {
            // Voting mode — clickable buttons
            return (
              <button
                key={i}
                type="button"
                onClick={() => castVote(i)}
                disabled={isVoting}
                className="w-full text-left px-4 py-2.5 rounded-xl border border-border/50 text-sm font-medium text-foreground hover:border-org-primary/50 hover:bg-org-primary/5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              >
                {opt.label}
              </button>
            );
          }

          // Results mode — progress bars
          return (
            <div
              key={i}
              onClick={meta.allow_change ? () => castVote(i) : undefined}
              role={meta.allow_change ? "button" : undefined}
              tabIndex={meta.allow_change ? 0 : undefined}
              onKeyDown={meta.allow_change ? (e) => { if (e.key === "Enter" || e.key === " ") castVote(i); } : undefined}
              className={`relative h-10 rounded-xl overflow-hidden ${meta.allow_change ? "cursor-pointer hover:opacity-90" : ""} ${isSelected ? "border-l-[3px] border-org-primary" : ""}`}
            >
              {/* Background fill */}
              <div
                className={`absolute inset-0 transition-all duration-500 ease-out ${isSelected ? "bg-org-primary/15" : "bg-muted/30"}`}
                style={{ width: `${pct}%` }}
              />
              {/* Text overlay */}
              <div className="relative flex items-center justify-between h-full px-3">
                <span className={`text-sm ${isSelected ? "font-semibold" : "font-medium"} flex items-center gap-1.5`}>
                  {isSelected && (
                    <svg className="h-3.5 w-3.5 text-org-primary shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                    </svg>
                  )}
                  {opt.label}
                </span>
                <span className="text-xs font-mono text-muted-foreground ml-2 shrink-0">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground pt-0.5">
        {totalVotes} {totalVotes === 1 ? "vote" : "votes"}
        {meta.allow_change && hasVoted && (
          <span className="ml-1.5 text-muted-foreground/60">&middot; Click to change</span>
        )}
      </p>
    </div>
  );
}
