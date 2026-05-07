"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { ErrorGroup } from "@/lib/error-alerts/queries";

interface ErrorGroupActionsProps {
  groupId: string;
  currentStatus: ErrorGroup["status"];
}

type ActionStatus = "resolved" | "ignored" | "muted" | "open";

interface ActionButton {
  label: string;
  status: ActionStatus;
  variant: "primary" | "secondary" | "ghost" | "danger";
}

function getAvailableActions(currentStatus: ErrorGroup["status"]): ActionButton[] {
  switch (currentStatus) {
    case "open":
      return [
        { label: "Acknowledge", status: "ignored", variant: "secondary" },
        { label: "Resolve", status: "resolved", variant: "primary" },
        { label: "Mute", status: "muted", variant: "ghost" },
      ];
    case "resolved":
      return [
        { label: "Reopen", status: "open", variant: "secondary" },
      ];
    case "ignored":
      return [
        { label: "Reopen", status: "open", variant: "secondary" },
        { label: "Resolve", status: "resolved", variant: "primary" },
      ];
    case "muted":
      return [
        { label: "Unmute", status: "open", variant: "secondary" },
      ];
    default:
      return [];
  }
}

export function ErrorGroupActions({ groupId, currentStatus }: ErrorGroupActionsProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState<ActionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actions = getAvailableActions(currentStatus);

  async function handleAction(newStatus: ActionStatus) {
    setIsLoading(newStatus);
    setError(null);

    try {
      const response = await fetch(`/api/admin/bugs/${groupId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update status");
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action.status}
            variant={action.variant}
            size="sm"
            isLoading={isLoading === action.status}
            disabled={isLoading !== null}
            onClick={() => handleAction(action.status)}
          >
            {action.label}
          </Button>
        ))}
      </div>
      {error && (
        <p className="text-sm text-error">{error}</p>
      )}
    </div>
  );
}
