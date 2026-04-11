"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Select, Textarea } from "@/components/ui";
import type { WorkoutStatus } from "@/types/database";

interface WorkoutLogEditorProps {
  orgId: string;
  workoutId: string;
  logId?: string | null;
  initialStatus: WorkoutStatus;
  initialNotes?: string | null;
  disabled?: boolean;
}

export function WorkoutLogEditor({
  orgId,
  workoutId,
  logId,
  initialStatus,
  initialNotes,
  disabled,
}: WorkoutLogEditorProps) {
  const [status, setStatus] = useState<WorkoutStatus>(initialStatus);
  const [notes, setNotes] = useState(initialNotes || "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (disabled) return;
    setIsSaving(true);
    setError(null);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("You must be signed in to update progress");
      setIsSaving(false);
      return;
    }

    const payload = {
      organization_id: orgId,
      workout_id: workoutId,
      user_id: user.id,
      status,
      notes: notes || null,
    };

    const { error: upsertError } = logId
      ? await supabase.from("workout_logs").update(payload).eq("id", logId)
      : await supabase.from("workout_logs").insert(payload);

    if (upsertError) {
      setError(upsertError.message);
    } else {
      // optimistic ok
    }

    setIsSaving(false);
  };

  return (
    <div className="space-y-3">
      {error && (
        <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}
      <Select
        label="Your status"
        value={status}
        disabled={disabled}
        onChange={(e) => setStatus(e.target.value as WorkoutStatus)}
        options={[
          { label: "Not started", value: "not_started" },
          { label: "In progress", value: "in_progress" },
          { label: "Completed", value: "completed" },
        ]}
      />
      <Textarea
        label="Notes (optional)"
        value={notes}
        disabled={disabled}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        placeholder="Add time, reps, or other details"
      />
      <div className="flex justify-end">
        <Button onClick={handleSave} isLoading={isSaving} disabled={disabled}>
          Save progress
        </Button>
      </div>
    </div>
  );
}

