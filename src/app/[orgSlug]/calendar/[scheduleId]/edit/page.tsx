"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea, Select } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { editScheduleSchema, type EditScheduleForm } from "@/lib/schemas/schedule";
import type { OccurrenceType } from "@/lib/schemas/common";

const DAYS_OF_WEEK = [
  { label: "Sunday", value: "0" },
  { label: "Monday", value: "1" },
  { label: "Tuesday", value: "2" },
  { label: "Wednesday", value: "3" },
  { label: "Thursday", value: "4" },
  { label: "Friday", value: "5" },
  { label: "Saturday", value: "6" },
];

export default function EditSchedulePage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const scheduleId = params.scheduleId as string;

  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    control,
    formState: { errors },
  } = useForm<EditScheduleForm>({
    resolver: zodResolver(editScheduleSchema),
    defaultValues: {
      title: "",
      occurrence_type: "weekly",
      start_time: "09:00",
      end_time: "10:00",
      start_date: "",
      end_date: "",
      day_of_week: ["1"],
      day_of_month: "1",
      notes: "",
    },
  });

  const occurrenceType = watch("occurrence_type");

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("academic_schedules")
      .select("*")
      .eq("id", scheduleId)
      .is("deleted_at", null)
      .single()
      .then(({ data, error: fetchError }) => {
        if (fetchError || !data) {
          router.push(`/${orgSlug}/calendar`);
          return;
        }
        reset({
          title: data.title,
          occurrence_type: data.occurrence_type,
          start_time: data.start_time,
          end_time: data.end_time,
          start_date: data.start_date,
          end_date: data.end_date || "",
          day_of_week: Array.isArray(data.day_of_week)
            ? data.day_of_week.map((day: number) => String(day))
            : data.day_of_week !== null
              ? [String(data.day_of_week)]
              : ["1"],
          day_of_month: String(data.day_of_month ?? 1),
          notes: data.notes || "",
        });
        setLoading(false);
      });
  }, [scheduleId, orgSlug, router, reset]);

  const onSubmit = async (data: EditScheduleForm) => {
    setIsLoading(true);
    setError(null);

    const supabase = createClient();

    const updateData: Record<string, unknown> = {
      title: data.title,
      occurrence_type: data.occurrence_type,
      start_time: data.start_time,
      end_time: data.end_time,
      start_date: data.start_date,
      end_date: data.end_date || null,
      notes: data.notes || null,
      day_of_week: null,
      day_of_month: null,
      updated_at: new Date().toISOString(),
    };

    if (data.occurrence_type === "weekly") {
      updateData.day_of_week = data.day_of_week.map((day) => parseInt(day, 10));
    } else if (data.occurrence_type === "monthly") {
      updateData.day_of_month = parseInt(data.day_of_month, 10);
    }

    const { error: updateError } = await supabase
      .from("academic_schedules")
      .update(updateData)
      .eq("id", scheduleId);

    if (updateError) {
      setError(updateError.message);
      setIsLoading(false);
      return;
    }

    router.push(`/${orgSlug}/calendar`);
    router.refresh();
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this schedule?")) return;

    setIsDeleting(true);
    const supabase = createClient();

    const { error: deleteError } = await supabase
      .from("academic_schedules")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", scheduleId);

    if (deleteError) {
      setError(deleteError.message);
      setIsDeleting(false);
      return;
    }

    router.push(`/${orgSlug}/calendar`);
    router.refresh();
  };

  if (loading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Edit Schedule" backHref={`/${orgSlug}/calendar`} />
        <Card className="max-w-2xl p-6">
          <p className="text-muted-foreground">Loading...</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Edit Schedule"
        backHref={`/${orgSlug}/calendar`}
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
            placeholder="e.g., Biology 101, Work shift"
            error={errors.title?.message}
            {...register("title")}
          />

          <Select
            label="Occurrence"
            value={occurrenceType}
            onChange={(e) => {
              const nextType = e.target.value as OccurrenceType;
              setValue("occurrence_type", nextType);
            }}
            error={errors.occurrence_type?.message}
            options={[
              { label: "Single event", value: "single" },
              { label: "Daily", value: "daily" },
              { label: "Weekly", value: "weekly" },
              { label: "Monthly", value: "monthly" },
            ]}
          />

          {occurrenceType === "weekly" && (
            <Controller
              name="day_of_week"
              control={control}
              render={({ field }) => (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Days of Week</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {DAYS_OF_WEEK.map((day) => {
                      const checked = field.value.includes(day.value);
                      return (
                        <label key={day.value} className="flex items-center gap-2 text-sm text-foreground border border-border rounded-lg px-3 py-2 hover:border-org-primary transition">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-org-primary"
                            checked={checked}
                            onChange={(e) => {
                              const newValue = e.target.checked
                                ? [...field.value, day.value]
                                : field.value.filter((v) => v !== day.value);
                              field.onChange(newValue);
                            }}
                          />
                          {day.label}
                        </label>
                      );
                    })}
                  </div>
                  {errors.day_of_week && (
                    <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                      {errors.day_of_week.message}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">Select all days this schedule repeats.</p>
                </div>
              )}
            />
          )}

          {occurrenceType === "monthly" && (
            <Select
              label="Day of Month"
              value={watch("day_of_month")}
              onChange={(e) => setValue("day_of_month", e.target.value)}
              error={errors.day_of_month?.message}
              options={Array.from({ length: 31 }, (_, i) => ({
                label: String(i + 1),
                value: String(i + 1),
              }))}
            />
          )}

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Start Time"
              type="time"
              error={errors.start_time?.message}
              {...register("start_time")}
            />
            <Input
              label="End Time"
              type="time"
              error={errors.end_time?.message}
              {...register("end_time")}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label={occurrenceType === "single" ? "Date" : "Start Date"}
              type="date"
              error={errors.start_date?.message}
              {...register("start_date")}
            />
            {occurrenceType !== "single" && (
              <Input
                label="End Date (optional)"
                type="date"
                error={errors.end_date?.message}
                {...register("end_date")}
              />
            )}
          </div>

          <Textarea
            label="Notes (optional)"
            rows={2}
            placeholder="Room number, professor name, etc."
            error={errors.notes?.message}
            {...register("notes")}
          />

          <div className="flex justify-between gap-3 pt-4 border-t border-border">
            <Button
              type="button"
              variant="secondary"
              onClick={handleDelete}
              isLoading={isDeleting}
              className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              Delete
            </Button>
            <div className="flex gap-3">
              <Button type="button" variant="secondary" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" isLoading={isLoading}>
                Save Changes
              </Button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}
