"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";

export default function AddPointsPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const [existingTeams, setExistingTeams] = useState<string[]>([]);
  
  const [formData, setFormData] = useState({
    team_name: "",
    points: "",
    notes: "",
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

      // Get Wagner Cup competition
      const { data: competitions } = await supabase
        .from("competitions")
        .select("id")
        .eq("organization_id", org.id)
        .ilike("name", "%wagner%")
        .limit(1);

      if (competitions?.[0]) {
        setCompetitionId(competitions[0].id);

        // Get existing team names
        const { data: points } = await supabase
          .from("competition_points")
          .select("team_name")
          .eq("competition_id", competitions[0].id);

        const teams = [...new Set(points?.map((p) => p.team_name).filter(Boolean))] as string[];
        setExistingTeams(teams);
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

    const { error: insertError } = await supabase.from("competition_points").insert({
      competition_id: competitionId,
      team_name: formData.team_name,
      points: parseInt(formData.points),
      notes: formData.notes || null,
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
        title="Add Points"
        description="Award points to a team in the Wagner Cup"
        backHref={`/${orgSlug}/competitions/wagner-cup`}
      />

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Team Name</label>
            <Input
              value={formData.team_name}
              onChange={(e) => setFormData({ ...formData, team_name: e.target.value })}
              placeholder="Enter team name"
              required
              list="existing-teams"
            />
            {existingTeams.length > 0 && (
              <datalist id="existing-teams">
                {existingTeams.map((team) => (
                  <option key={team} value={team} />
                ))}
              </datalist>
            )}
            {existingTeams.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="text-xs text-muted-foreground">Quick select:</span>
                {existingTeams.map((team) => (
                  <button
                    key={team}
                    type="button"
                    onClick={() => setFormData({ ...formData, team_name: team })}
                    className={`text-xs px-2 py-1 rounded-lg transition-colors ${
                      formData.team_name === team
                        ? "bg-org-primary text-white"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {team}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Input
            label="Points"
            type="number"
            value={formData.points}
            onChange={(e) => setFormData({ ...formData, points: e.target.value })}
            placeholder="Enter points (can be negative)"
            required
          />

          <Textarea
            label="Notes (Optional)"
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            placeholder="e.g., Won the scrimmage, Community service hours"
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

