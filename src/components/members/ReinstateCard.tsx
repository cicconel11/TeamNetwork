"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button } from "@/components/ui";

interface ReinstateCardProps {
  orgId: string;
  memberId: string;
  memberName: string;
}

export function ReinstateCard({ orgId, memberId, memberName }: ReinstateCardProps) {
  const router = useRouter();
  const [isReinstating, setIsReinstating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleReinstate = async () => {
    setIsReinstating(true);
    setError(null);

    const response = await fetch(
      `/api/organizations/${orgId}/members/${memberId}/reinstate`,
      { method: "POST" }
    );

    const data = await response.json();

    if (!response.ok) {
      setError(data.error || "Failed to reinstate member");
    } else {
      setSuccess(true);
      router.refresh();
    }
    setIsReinstating(false);
  };

  if (success) {
    return (
      <Card className="p-6 lg:col-span-3 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
        <div className="flex items-center gap-3">
          <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="font-medium text-green-800 dark:text-green-200">
            {memberName} has been reinstated and is pending approval
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 lg:col-span-3 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-amber-800 dark:text-amber-200">
            This member is an alumni
          </p>
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Reinstate them as an active member (requires approval)
          </p>
        </div>
        <Button
          onClick={handleReinstate}
          isLoading={isReinstating}
          variant="secondary"
          className="whitespace-nowrap"
        >
          Reinstate as Active Member
        </Button>
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}
    </Card>
  );
}
