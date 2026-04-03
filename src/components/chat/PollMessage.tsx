"use client";

import { UserContent } from "@/components/i18n/UserContent";
import type { ChatMessage, ChatPollVote, User } from "@/types/database";
import { pollMetadataSchema, type PollMetadata } from "@/lib/schemas/chat-polls";

interface PollMessageProps {
  message: ChatMessage;
  currentUserId: string;
  votes: ChatPollVote[];
  userMap: Map<string, User>;
  onVote?: (messageId: string, optionIndex: number) => void;
  onRetractVote?: (messageId: string) => void;
}

export function PollMessage({
  message,
  currentUserId,
  votes,
  userMap,
  onVote,
  onRetractVote,
}: PollMessageProps) {
  const parsed = pollMetadataSchema.passthrough().safeParse(message.metadata);
  if (!parsed.success) {
    return <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">[Invalid poll]</p>;
  }
  const metadata: PollMetadata = parsed.data;

  const userVote = votes.find((v) => v.user_id === currentUserId);
  const totalVotes = votes.length;
  const voteLocked = metadata.allow_change === false && !!userVote;

  const voteCounts = votes.reduce<Record<number, number>>((acc, vote) => {
    return { ...acc, [vote.option_index]: (acc[vote.option_index] ?? 0) + 1 };
  }, {});

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] overflow-hidden max-w-full">
      <h4
        className="p-3 text-sm font-semibold text-foreground"
        style={{ textWrap: "balance" } as React.CSSProperties}
      >
        <UserContent>{metadata.question}</UserContent>
      </h4>

      <div className="divide-y divide-[var(--border)]">
        {metadata.options.map((option, index) => {
          const isSelected = userVote?.option_index === index;
          const voteCount = voteCounts[index] ?? 0;
          const optionVoters = votes.filter((v) => v.option_index === index);
          const visibleVoters = optionVoters
            .slice(0, 3)
            .map((v) => userMap.get(v.user_id)?.name ?? "Unknown");
          const extraVoterCount = optionVoters.length - 3;
          const voterSummary =
            visibleVoters.length > 0
              ? extraVoterCount > 0
                ? `${visibleVoters.join(", ")} +${extraVoterCount}`
                : visibleVoters.join(", ")
              : null;

          return (
            <button
              key={index}
              type="button"
              onClick={() => onVote?.(message.id, index)}
              disabled={voteLocked}
              aria-pressed={isSelected}
              title={voterSummary ?? undefined}
              className={[
                "px-3 py-2.5 w-full flex items-center gap-3 text-sm text-left",
                "hover:bg-muted transition-colors duration-200",
                "focus-visible:ring-2 focus-visible:ring-[var(--color-org-primary)] focus-visible:outline-none",
                "disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-transparent",
                isSelected
                  ? "bg-[var(--color-org-secondary)]/10 border-l-2 border-l-[var(--color-org-secondary)]"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ touchAction: "manipulation" }}
            >
              <UserContent as="span" className="flex-1">
                {option.label}
              </UserContent>
              <span
                className="text-xs text-muted-foreground"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {voteCount}
              </span>
            </button>
          );
        })}
      </div>

      {userVote && (
        <div className="px-3 py-2">
          {metadata.options.map((_, index) => {
            const percentage =
              totalVotes > 0 ? ((voteCounts[index] ?? 0) / totalVotes) * 100 : 0;
            return (
              <div
                key={index}
                className="h-1 bg-muted rounded-full overflow-hidden mb-1 last:mb-0"
              >
                <div
                  className="h-full bg-[var(--color-org-secondary)] rounded-full"
                  style={{ width: `${percentage}%`, transition: "width 300ms ease-out" }}
                />
              </div>
            );
          })}
        </div>
      )}

      <div
        className="px-3 py-2 bg-muted/50 text-xs text-muted-foreground flex items-center justify-between"
        aria-live="polite"
      >
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {totalVotes} vote{totalVotes !== 1 ? "s" : ""}
        </span>
        {userVote && onRetractVote && !voteLocked && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRetractVote(message.id);
            }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-200 underline focus-visible:ring-2 focus-visible:ring-[var(--color-org-primary)] focus-visible:outline-none rounded"
          >
            Retract vote
          </button>
        )}
        {voteLocked && <span>Vote locked</span>}
      </div>
    </div>
  );
}
