"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input } from "@/components/ui";
import { PageHeader } from "@/components/layout";

export default function AddTeamPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCompetition = async () => {
      const supabase = createClient();

      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .single();

      if (!org) return;

      const { data: competitions } = await supabase
        .from("competitions")
        .select("id")
        .eq("organization_id", org.id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (competitions?.[0]) {
        setCompetitionId(competitions[0].id);
      }
    };

    fetchCompetition();
  }, [orgSlug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!competitionId) {
      setError("Competition not found");
      return;
    }

    setIsLoading(true);
    setError(null);

    const supabase = createClient();
    const { data: competition } = await supabase
      .from("competitions")
      .select("organization_id")
      .eq("id", competitionId)
      .maybeSingle();

    const { error: insertError } = await supabase.from("competition_teams").insert({
      competition_id: competitionId,
      organization_id: competition?.organization_id || null,
      name: teamName,
    });

    if (insertError) {
      setError(insertError.message);
      setIsLoading(false);
      return;
    }

    router.push(`/${orgSlug}/competition`);
    router.refresh();
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Add Team"
        description="Create a team for this competition"
        backHref={`/${orgSlug}/competition`}
      />

      <Card className="max-w-xl">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <Input
            label="Team Name"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            required
          />

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading}>
              Add Team
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

