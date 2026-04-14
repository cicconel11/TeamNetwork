"use client";

import { ReactNode, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/ui";
import { MentorshipPairCard } from "./MentorshipPairCard";
import {
  getVisibleMentorshipPairs,
  isUserInMentorshipPair,
} from "@/lib/mentorship/presentation";

interface MentorshipLog {
  id: string;
  pair_id: string;
  entry_date: string;
  notes: string | null;
  progress_metric: number | null;
  created_by: string;
}

interface MentorshipPair {
  id: string;
  mentor_user_id: string;
  mentee_user_id: string;
  status: string;
}

interface User {
  id: string;
  name: string | null;
  email: string | null;
}

interface MentorshipPairsListProps {
  initialPairs: MentorshipPair[];
  logs: MentorshipLog[];
  users: User[];
  isAdmin: boolean;
  canLogActivity: boolean;
  orgId: string;
  currentUserId?: string;
  emptyStateAction?: ReactNode;
}

export function MentorshipPairsList({
  initialPairs,
  logs,
  users,
  isAdmin,
  canLogActivity,
  orgId,
  currentUserId,
  emptyStateAction,
}: MentorshipPairsListProps) {
  const tMentorship = useTranslations("mentorship");
  const [deletedPairIds, setDeletedPairIds] = useState<string[]>([]);

  useEffect(() => {
    setDeletedPairIds((current) =>
      current.filter((pairId) => initialPairs.some((pair) => pair.id === pairId))
    );
  }, [initialPairs]);

  const userLabel = (id: string) => {
    const u = users.find((user) => user.id === id);
    return u?.name || u?.email || "Unknown";
  };

  const handleDelete = (pairId: string) => {
    setDeletedPairIds((current) =>
      current.includes(pairId) ? current : [...current, pairId]
    );
  };

  const visiblePairs = getVisibleMentorshipPairs(initialPairs, deletedPairIds);

  if (visiblePairs.length === 0) {
    return (
      <div className="py-8">
        <EmptyState
          title={tMentorship("noPairs")}
          description={tMentorship("pairsWillAppear")}
          action={emptyStateAction}
        />
      </div>
    );
  }

  return (
    <div>
      {visiblePairs.map((pair) => {
        const pairLogs = logs.filter((l) => l.pair_id === pair.id);
        const isMine = isUserInMentorshipPair(pair, currentUserId);
        return (
          <MentorshipPairCard
            key={pair.id}
            pair={pair}
            mentorLabel={userLabel(pair.mentor_user_id)}
            menteeLabel={userLabel(pair.mentee_user_id)}
            logs={pairLogs}
            isAdmin={isAdmin}
            canLogActivity={canLogActivity}
            orgId={orgId}
            userLabel={userLabel}
            onDelete={handleDelete}
            highlight={isMine}
          />
        );
      })}
    </div>
  );
}
