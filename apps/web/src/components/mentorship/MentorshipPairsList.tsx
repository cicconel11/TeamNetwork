"use client";

import { useState } from "react";
import { Card, EmptyState } from "@/components/ui";
import { MentorshipPairCard } from "./MentorshipPairCard";

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
}

export function MentorshipPairsList({
  initialPairs,
  logs,
  users,
  isAdmin,
  canLogActivity,
  orgId,
}: MentorshipPairsListProps) {
  const [pairs, setPairs] = useState<MentorshipPair[]>(initialPairs);

  const userLabel = (id: string) => {
    const u = users.find((user) => user.id === id);
    return u?.name || u?.email || "Unknown";
  };

  const handleDelete = (pairId: string) => {
    setPairs((prev) => prev.filter((p) => p.id !== pairId));
  };

  if (pairs.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No mentorship pairs yet"
          description="Pairs will appear here once created."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {pairs.map((pair) => {
        const pairLogs = logs.filter((l) => l.pair_id === pair.id);
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
          />
        );
      })}
    </div>
  );
}
