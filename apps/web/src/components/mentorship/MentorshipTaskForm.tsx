"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { showFeedback } from "@/lib/feedback/show-feedback";
/* eslint-disable @typescript-eslint/no-explicit-any */
interface MentorshipTaskFormProps {
  pairId: string;
  orgId: string;
  onTaskCreated: (task: any) => void;
  onCancel: () => void;
}

export function MentorshipTaskForm({
  pairId,
  orgId,
  onTaskCreated,
  onCancel,
}: MentorshipTaskFormProps) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      showFeedback("Title is required", "error");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(
        `/api/organizations/${orgId}/mentorship/tasks`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pair_id: pairId,
            title: title.trim(),
            due_date: dueDate || undefined,
            status: "todo",
          }),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        showFeedback(result.error || "Failed to create task", "error");
        setIsSubmitting(false);
        return;
      }

      showFeedback("Task created", "success");
      onTaskCreated(result.task);
      setTitle("");
      setDueDate("");
    } catch {
      showFeedback("An unexpected error occurred", "error");
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-3 px-4 py-2.5 bg-[var(--muted)]/5 rounded-md animate-fade-in"
    >
      {/* Placeholder status circle */}
      <div className="flex-shrink-0 w-4 h-4 rounded-full border-[1.5px] border-[var(--muted-foreground)]/30" />

      {/* Title input */}
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Task title…"
        autoFocus
        required
        aria-label="Task title"
        className="flex-1 min-w-0 bg-transparent text-sm font-medium text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]/60"
      />

      {/* Due date */}
      <input
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        aria-label="Due date"
        className="flex-shrink-0 w-28 bg-transparent text-xs text-[var(--muted-foreground)] outline-none"
      />

      {/* Actions */}
      <div className="flex-shrink-0 flex items-center gap-1.5">
        <Button type="submit" size="sm" disabled={isSubmitting} isLoading={isSubmitting}>
          Create
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
