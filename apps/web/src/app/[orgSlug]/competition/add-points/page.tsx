"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea, Select } from "@/components/ui";
import { PageHeader } from "@/components/layout";

type TeamOption = { id: string; name: string };

export default function AddPointsPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamOption[]>([]);

  const [formData, setFormData] = useState({
    team_id: "",
    team_name: "",
    points: "",
    notes: "",
    reason: "",
  });

  useEffect(() => {
    const fetchCompetition = async () => {
      const supabase = createClient();

      // Get organization
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .single();

      if (!org) return;
      setOrganizationId(org.id);

      // Get latest competition
      const { data: competitions } = await supabase
        .from("competitions")
        .select("id")
        .eq("organization_id", org.id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (competitions?.[0]) {
        setCompetitionId(competitions[0].id);

        const { data: teamRows } = await supabase
          .from("competition_teams")
          .select("id,name")
          .eq("competition_id", competitions[0].id)
          .order("name");

        setTeams(teamRows || []);
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

    if (!formData.team_id && !formData.team_name) {
      setError("Select a team or enter a team name");
      return;
    }

    setIsLoading(true);
    setError(null);

    const supabase = createClient();

    const { error: insertError } = await supabase.from("competition_points").insert({
      competition_id: competitionId,
      organization_id: organizationId,
      team_id: formData.team_id || null,
      team_name: formData.team_name || null,
      points: parseInt(formData.points),
      notes: formData.notes || null,
      reason: formData.reason || null,
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
        title="Add Points"
        description="Award points to a team"
        backHref={`/${orgSlug}/competition`}
      />

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <Select
            label="Select Team"
            value={formData.team_id}
            onChange={(e) => setFormData({ ...formData, team_id: e.target.value, team_name: "" })}
            options={[
              { value: "", label: "Choose a team" },
              ...teams.map((team) => ({ value: team.id, label: team.name })),
            ]}
          />

          <Input
            label="Or enter a new team name"
            value={formData.team_name}
            onChange={(e) => setFormData({ ...formData, team_name: e.target.value, team_id: "" })}
            placeholder="e.g., Blue Squad"
          />

          <Input
            label="Points"
            type="number"
            value={formData.points}
            onChange={(e) => setFormData({ ...formData, points: e.target.value })}
            placeholder="Enter points (can be negative)"
            required
          />

          <Input
            label="Reason"
            value={formData.reason}
            onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
            placeholder="Why the points were awarded"
          />

          <Textarea
            label="Notes (Optional)"
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            placeholder="e.g., Won the scrimmage, community service hours"
            rows={3}
          />

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading}>
              Add Points
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

