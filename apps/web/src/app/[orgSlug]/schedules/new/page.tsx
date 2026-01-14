"use client";

import { useEffect, useState, FormEvent } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea, Select } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import type { OccurrenceType } from "@/types/database";

const DAYS_OF_WEEK = [
  { label: "Sunday", value: "0" },
  { label: "Monday", value: "1" },
  { label: "Tuesday", value: "2" },
  { label: "Wednesday", value: "3" },
  { label: "Thursday", value: "4" },
  { label: "Friday", value: "5" },
  { label: "Saturday", value: "6" },
];

export default function NewSchedulePage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  const [orgId, setOrgId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    occurrence_type: "weekly" as OccurrenceType,
    start_time: "09:00",
    end_time: "10:00",
    start_date: new Date().toISOString().split("T")[0],
    end_date: "",
    day_of_week: ["1"],
    day_of_month: "1",
    notes: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("organizations")
      .select("id")
      .eq("slug", orgSlug)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setOrgId(data.id);
      });
  }, [orgSlug]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    if (formData.start_time >= formData.end_time) {
      setError("End time must be after start time");
      setIsLoading(false);
      return;
    }

    if (formData.end_date && formData.start_date > formData.end_date) {
      setError("End date must be on or after start date");
      setIsLoading(false);
      return;
    }

    if (formData.occurrence_type === "weekly" && formData.day_of_week.length === 0) {
      setError("Select at least one day of the week");
      setIsLoading(false);
      return;
    }

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!orgId || !user) {
      setError("Unable to create schedule");
      setIsLoading(false);
      return;
    }

    const insertData: Record<string, unknown> = {
      organization_id: orgId,
      user_id: user.id,
      title: formData.title,
      occurrence_type: formData.occurrence_type,
      start_time: formData.start_time,
      end_time: formData.end_time,
      start_date: formData.start_date,
      end_date: formData.end_date || null,
      notes: formData.notes || null,
      day_of_week: null,
      day_of_month: null,
    };

    if (formData.occurrence_type === "weekly") {
      insertData.day_of_week = formData.day_of_week.map((day) => parseInt(day, 10));
    } else if (formData.occurrence_type === "monthly") {
      insertData.day_of_month = parseInt(formData.day_of_month, 10);
    }

    const { error: insertError } = await supabase
      .from("academic_schedules")
      .insert(insertData);

    if (insertError) {
      setError(insertError.message);
      setIsLoading(false);
      return;
    }

    router.push(`/${orgSlug}/schedules`);
    router.refresh();
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Add Schedule"
        description="Add a class or academic commitment"
        backHref={`/${orgSlug}/schedules`}
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
            placeholder="e.g., Biology 101, Work shift"
            required
          />

          <Select
            label="Occurrence"
            value={formData.occurrence_type}
            onChange={(e) => {
              const nextType = e.target.value as OccurrenceType;
              setFormData((prev) => ({
                ...prev,
                occurrence_type: nextType,
                day_of_week: nextType === "weekly" && prev.day_of_week.length === 0 ? ["1"] : prev.day_of_week,
              }));
            }}
            options={[
              { label: "Single event", value: "single" },
              { label: "Daily", value: "daily" },
              { label: "Weekly", value: "weekly" },
              { label: "Monthly", value: "monthly" },
            ]}
          />

          {formData.occurrence_type === "weekly" && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Days of Week</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {DAYS_OF_WEEK.map((day) => {
                  const checked = formData.day_of_week.includes(day.value);
                  return (
                    <label key={day.value} className="flex items-center gap-2 text-sm text-foreground border border-border rounded-lg px-3 py-2 hover:border-org-primary transition">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-org-primary"
                        checked={checked}
                        onChange={(e) => {
                          setFormData((prev) => ({
                            ...prev,
                            day_of_week: e.target.checked
                              ? [...prev.day_of_week, day.value]
                              : prev.day_of_week.filter((v) => v !== day.value),
                          }));
                        }}
                      />
                      {day.label}
                    </label>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">Select all days this schedule repeats.</p>
            </div>
          )}

          {formData.occurrence_type === "monthly" && (
            <Select
              label="Day of Month"
              value={formData.day_of_month}
              onChange={(e) => setFormData({ ...formData, day_of_month: e.target.value })}
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
              value={formData.start_time}
              onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
              required
            />
            <Input
              label="End Time"
              type="time"
              value={formData.end_time}
              onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label={formData.occurrence_type === "single" ? "Date" : "Start Date"}
              type="date"
              value={formData.start_date}
              onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
              required
            />
            {formData.occurrence_type !== "single" && (
              <Input
                label="End Date (optional)"
                type="date"
                value={formData.end_date}
                onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
              />
            )}
          </div>

          <Textarea
            label="Notes (optional)"
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            rows={2}
            placeholder="Room number, professor name, etc."
          />

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading}>
              Add Schedule
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
