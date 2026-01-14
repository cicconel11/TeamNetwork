"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { resolveActionLabel } from "@/lib/navigation/label-resolver";
import { editWorkoutSchema, type EditWorkoutForm } from "@/lib/schemas/content";
import type { NavConfig } from "@/lib/navigation/nav-items";
import type { Workout } from "@/types/database";

export default function EditWorkoutPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const workoutId = params.workoutId as string;

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [navConfig, setNavConfig] = useState<NavConfig | null>(null);

  // Get the custom label for this page
  const singularLabel = resolveActionLabel("/workouts", navConfig, "").trim();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EditWorkoutForm>({
    resolver: zodResolver(editWorkoutSchema),
    defaultValues: {
      title: "",
      description: "",
      workout_date: "",
      external_url: "",
    },
  });

  useEffect(() => {
    const fetchWorkout = async () => {
      const supabase = createClient();

      const { data: org } = await supabase
        .from("organizations")
        .select("id, nav_config")
        .eq("slug", orgSlug)
        .single();

      if (!org) {
        setError("Organization not found");
        setIsFetching(false);
        return;
      }

      // Parse nav_config
      if (org.nav_config && typeof org.nav_config === "object" && !Array.isArray(org.nav_config)) {
        setNavConfig(org.nav_config as NavConfig);
      }

      const { data: workout } = await supabase
        .from("workouts")
        .select("*")
        .eq("id", workoutId)
        .eq("organization_id", org.id)
        .single();

      if (!workout) {
        setError("Workout not found");
        setIsFetching(false);
        return;
      }

      const w = workout as Workout;
      reset({
        title: w.title || "",
        description: w.description || "",
        workout_date: w.workout_date ? w.workout_date.split("T")[0] : "",
        external_url: w.external_url || "",
      });
      setIsFetching(false);
    };

    fetchWorkout();
  }, [orgSlug, workoutId, reset]);

  const onSubmit = async (data: EditWorkoutForm) => {
    setIsLoading(true);
    setError(null);

    const supabase = createClient();

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

    const { error: updateError } = await supabase
      .from("workouts")
      .update({
        title: data.title,
        description: data.description || null,
        workout_date: data.workout_date ? data.workout_date : null,
        external_url: data.external_url || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", workoutId)
      .eq("organization_id", org.id);

    if (updateError) {
      setError(updateError.message);
      setIsLoading(false);
      return;
    }

    router.push(`/${orgSlug}/workouts`);
    router.refresh();
  };

  if (isFetching) {
    return (
      <div className="animate-fade-in">
        <PageHeader
          title={`Edit ${singularLabel}`}
          description="Loading..."
          backHref={`/${orgSlug}/workouts`}
        />
        <Card className="max-w-2xl p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-10 bg-muted rounded-xl" />
            <div className="h-24 bg-muted rounded-xl" />
            <div className="h-10 bg-muted rounded-xl" />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={`Edit ${singularLabel}`}
        description={`Update ${singularLabel.toLowerCase()} details`}
        backHref={`/${orgSlug}/workouts`}
      />

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <Input
            label="Title"
            error={errors.title?.message}
            {...register("title")}
          />

          <Textarea
            label="Description"
            rows={3}
            error={errors.description?.message}
            {...register("description")}
          />

          <Input
            label="Date"
            type="date"
            error={errors.workout_date?.message}
            {...register("workout_date")}
          />

          <Input
            label="External workout link (optional)"
            type="url"
            placeholder="https://example.com/workout"
            helperText="Must be https://"
            error={errors.external_url?.message}
            {...register("external_url")}
          />

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading}>
              Save Changes
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
