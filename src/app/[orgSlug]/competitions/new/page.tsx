"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";

export default function NewCompetitionPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    name: "Wagner Cup",
    description: "",
    season: new Date().getFullYear().toString(),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const supabase = createClient();

    // Get organization ID
    const { data: orgs, error: orgError } = await supabase
      .from("organizations")
      .select("id")
      .eq("slug", orgSlug)
      .limit(1);

    const org = orgs?.[0];

    if (!org || orgError) {
      setError("Organization not found");
      setIsLoading(false);
      return;
    }

    const { error: insertError } = await supabase.from("competitions").insert({
      organization_id: org.id,
      name: formData.name,
      description: formData.description || null,
      season: formData.season || null,
    });

    if (insertError) {
      setError(insertError.message);
      setIsLoading(false);
      return;
    }

    router.push(`/${orgSlug}/competitions/wagner-cup`);
    router.refresh();
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Create Competition"
        description="Set up a new internal competition"
        backHref={`/${orgSlug}/competitions/wagner-cup`}
      />

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <Input
            label="Competition Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., Wagner Cup"
            required
          />

          <Textarea
            label="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Describe the competition and how points are earned..."
            rows={3}
          />

          <Input
            label="Season"
            value={formData.season}
            onChange={(e) => setFormData({ ...formData, season: e.target.value })}
            placeholder="e.g., 2025, Fall 2025"
          />

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading}>
              Create Competition
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

