"use client";

import { useState } from "react";
import { Button, Input, Textarea } from "@/components/ui";
import { showFeedback } from "@/lib/feedback/show-feedback";
import type { MentorshipTask } from "@/types/database";

interface MentorshipTaskFormProps {
  pairId: string;
  orgId: string;
  onTaskCreated: (task: MentorshipTask) => void;
  onCancel: () => void;
}

export function MentorshipTaskForm({
  pairId,
  orgId,
  onTaskCreated,
  onCancel,
}: MentorshipTaskFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate title
    if (!title.trim()) {
      showFeedback("error", "Title is required");
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
            description: description.trim() || undefined,
            due_date: dueDate || undefined,
            status: "todo",
          }),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        showFeedback("error", result.error || "Failed to create task");
        setIsSubmitting(false);
        return;
      }

      showFeedback("success", "Task created");
      onTaskCreated(result.task);
      setTitle("");
      setDescription("");
      setDueDate("");
    } catch {
      showFeedback("error", "An unexpected error occurred");
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 border-t pt-4 mt-4">
      <Input
        label="Title"
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title"
        required
      />

      <Textarea
        label="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Add task details..."
        rows={3}
        maxLength={2000}
      />

      <Input
        label="Due date (optional)"
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
      />

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting} isLoading={isSubmitting}>
          Create Task
        </Button>
      </div>
    </form>
  );
}
