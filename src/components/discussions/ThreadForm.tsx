"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { createThreadSchema, type CreateThreadForm } from "@/lib/schemas/discussion";

interface ThreadFormProps {
  orgId: string;
  orgSlug: string;
}

export function ThreadForm({ orgId, orgSlug }: ThreadFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<CreateThreadForm>({
    title: "",
    body: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate
    const parsed = createThreadSchema.safeParse(formData);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      setError(`${firstError.path.join(".")}: ${firstError.message}`);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/discussions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          title: formData.title,
          body: formData.body,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || "Failed to create thread");
        setIsSubmitting(false);
        return;
      }

      // Redirect to the discussions list with fresh data
      router.replace(`/${orgSlug}/discussions`);
      router.refresh();
    } catch (err) {
      setError("An unexpected error occurred");
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-800 text-sm">{error}</div>
        )}

        <div>
          <label htmlFor="title" className="block text-sm font-medium text-foreground mb-2">
            Title
          </label>
          <Input
            id="title"
            type="text"
            value={formData.title}
            onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
            placeholder="What's your discussion about?"
            maxLength={200}
            required
          />
        </div>

        <div>
          <label htmlFor="body" className="block text-sm font-medium text-foreground mb-2">
            Description
          </label>
          <Textarea
            id="body"
            value={formData.body}
            onChange={(e) => setFormData((prev) => ({ ...prev, body: e.target.value }))}
            placeholder="Provide details about your discussion..."
            rows={8}
            maxLength={10000}
            required
          />
        </div>

        <div className="flex gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Thread"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.push(`/${orgSlug}/discussions`)} disabled={isSubmitting}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
