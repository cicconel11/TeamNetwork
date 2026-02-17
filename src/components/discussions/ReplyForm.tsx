"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { createReplySchema, type CreateReplyForm } from "@/lib/schemas/discussion";

interface ReplyFormProps {
  threadId: string;
  isLocked: boolean;
}

export function ReplyForm({ threadId, isLocked }: ReplyFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<CreateReplyForm>({
    body: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate
    const parsed = createReplySchema.safeParse(formData);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      setError(`${firstError.path.join(".")}: ${firstError.message}`);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/discussions/${threadId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: formData.body }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || "Failed to post reply");
        setIsSubmitting(false);
        return;
      }

      // Clear form and refresh
      setFormData({ body: "" });
      router.refresh();
    } catch (err) {
      setError("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLocked) {
    return (
      <div className="p-4 bg-muted border border-border rounded-md text-center">
        <p className="text-sm text-muted-foreground">This thread is locked. No new replies can be added.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-800 text-sm">{error}</div>}

      <div>
        <label htmlFor="reply-body" className="block text-sm font-medium text-foreground mb-2">
          Add a reply
        </label>
        <Textarea
          id="reply-body"
          value={formData.body}
          onChange={(e) => setFormData({ body: e.target.value })}
          placeholder="Share your thoughts..."
          rows={4}
          maxLength={5000}
          required
        />
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Posting..." : "Post Reply"}
      </Button>
    </form>
  );
}
