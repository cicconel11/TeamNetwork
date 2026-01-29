"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { newRecordSchema, type NewRecordForm } from "@/lib/schemas/content";

export default function NewRecordPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<NewRecordForm>({
    resolver: zodResolver(newRecordSchema),
    defaultValues: {
      title: "",
      category: "",
      value: "",
      holder_name: "",
      year: undefined,
      notes: "",
    },
  });

  const onSubmit = async (data: NewRecordForm) => {
    setIsLoading(true);
    setError(null);

    const supabase = createClient();

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

    const { error: insertError } = await supabase.from("records").insert({
      organization_id: org.id,
      title: data.title,
      category: data.category || null,
      value: data.value,
      holder_name: data.holder_name,
      year: data.year ? parseInt(data.year, 10) : null,
      notes: data.notes || null,
    });

    if (insertError) {
      setError(insertError.message);
      setIsLoading(false);
      return;
    }

    router.push(`/${orgSlug}/records`);
    router.refresh();
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Add New Record"
        description="Add a record to your organization's record book"
        backHref={`/${orgSlug}/records`}
      />

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <Input
            label="Record Title"
            placeholder="e.g., Most Passing Yards (Season)"
            error={errors.title?.message}
            {...register("title")}
          />

          <Input
            label="Category"
            placeholder="e.g., Passing, Rushing, Special Teams"
            helperText="Records will be grouped by category"
            error={errors.category?.message}
            {...register("category")}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Record Value"
              placeholder="e.g., 2,847 yards, 18 touchdowns"
              error={errors.value?.message}
              {...register("value")}
            />
            <Input
              label="Year Set"
              type="number"
              placeholder="2020"
              min={1900}
              max={2100}
              error={errors.year?.message}
              {...register("year")}
            />
          </div>

          <Input
            label="Record Holder"
            placeholder="Name of the record holder"
            error={errors.holder_name?.message}
            {...register("holder_name")}
          />

          <Textarea
            label="Notes"
            placeholder="Any additional context about this record..."
            rows={3}
            error={errors.notes?.message}
            {...register("notes")}
          />

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading}>
              Add Record
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
