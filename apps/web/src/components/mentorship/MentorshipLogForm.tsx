"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Textarea } from "@/components/ui";

interface MentorshipLogFormProps {
  orgId: string;
  pairId: string;
  onLogCreated?: () => void;
}

export function MentorshipLogForm({ orgId, pairId, onLogCreated }: MentorshipLogFormProps) {
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [progressMetric, setProgressMetric] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("You must be signed in to log progress.");
      setIsSaving(false);
      return;
    }

    const { error: insertError } = await supabase.from("mentorship_logs").insert({
      organization_id: orgId,
      pair_id: pairId,
      created_by: user.id,
      entry_date: entryDate,
      notes: notes || null,
      progress_metric: progressMetric ? parseInt(progressMetric) : null,
    });

    if (insertError) {
      setError(insertError.message);
      setIsSaving(false);
      return;
    }

    setNotes("");
    setProgressMetric("");
    setIsSaving(false);
    onLogCreated?.();
  };

  return (
    <form onSubmit={handleSave} className="space-y-2">
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      <Input
        label="Date"
        type="date"
        value={entryDate}
        onChange={(e) => setEntryDate(e.target.value)}
        required
      />
      <Textarea
        label="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        placeholder="What did you work on?"
      />
      <Input
        label="Progress metric (optional)"
        type="number"
        value={progressMetric}
        onChange={(e) => setProgressMetric(e.target.value)}
        placeholder="e.g., 3 sessions"
      />
      <div className="flex justify-end">
        <Button type="submit" isLoading={isSaving}>
          Save log
        </Button>
      </div>
    </form>
  );
}

