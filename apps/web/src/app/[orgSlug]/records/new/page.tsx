"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";

export default function NewRecordPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    title: "",
    category: "",
    value: "",
    holder_name: "",
    year: "",
    notes: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      title: formData.title,
      category: formData.category || null,
      value: formData.value,
      holder_name: formData.holder_name,
      year: formData.year ? parseInt(formData.year) : null,
      notes: formData.notes || null,
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
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <Input
            label="Record Title"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="e.g., Most Passing Yards (Season)"
            required
          />

          <Input
            label="Category"
            value={formData.category}
            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            placeholder="e.g., Passing, Rushing, Special Teams"
            helperText="Records will be grouped by category"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Record Value"
              value={formData.value}
              onChange={(e) => setFormData({ ...formData, value: e.target.value })}
              placeholder="e.g., 2,847 yards, 18 touchdowns"
              required
            />
            <Input
              label="Year Set"
              type="number"
              value={formData.year}
              onChange={(e) => setFormData({ ...formData, year: e.target.value })}
              placeholder="2020"
              min={1900}
              max={2100}
            />
          </div>

          <Input
            label="Record Holder"
            value={formData.holder_name}
            onChange={(e) => setFormData({ ...formData, holder_name: e.target.value })}
            placeholder="Name of the record holder"
            required
          />

          <Textarea
            label="Notes"
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            placeholder="Any additional context about this record..."
            rows={3}
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

