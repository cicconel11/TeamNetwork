"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";

export default function NewWorkoutPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    workout_date: "",
    external_url: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Get organization ID
    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("slug", orgSlug)
      .single();

    if (!org) {
      setError("Organization not found");
      setIsLoading(false);
      return;
    }

    const external = formData.external_url.trim();
    if (external) {
      try {
        const url = new URL(external);
        if (url.protocol !== "https:") throw new Error("URL must start with https://");
      } catch {
        setError("Please provide a valid https:// URL");
        setIsLoading(false);
        return;
      }
    }

    const { error: insertError } = await supabase.from("workouts").insert({
      organization_id: org.id,
      title: formData.title,
      description: formData.description || null,
      workout_date: formData.workout_date ? formData.workout_date : null,
      external_url: external || null,
      created_by: user?.id || null,
    });

    if (insertError) {
      setError(insertError.message);
      setIsLoading(false);
      return;
    }

    router.push(`/${orgSlug}/workouts`);
    router.refresh();
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Post Workout"
        description="Create a new workout for the team"
        backHref={`/${orgSlug}/workouts`}
      />

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <Input
            label="Title"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            required
          />

          <Textarea
            label="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={3}
          />

          <Input
            label="Date"
            type="date"
            value={formData.workout_date}
            onChange={(e) => setFormData({ ...formData, workout_date: e.target.value })}
          />

          <Input
            label="External workout link (optional)"
            type="url"
            value={formData.external_url}
            onChange={(e) => setFormData({ ...formData, external_url: e.target.value })}
            placeholder="https://example.com/workout"
            helperText="Must be https://"
          />

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading}>
              Post Workout
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

