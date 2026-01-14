"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Select } from "@/components/ui";

type Option = { value: string; label: string };

interface MentorshipAdminPanelProps {
  orgId: string;
  orgSlug: string;
}

export function MentorshipAdminPanel({ orgId, orgSlug }: MentorshipAdminPanelProps) {
  const [mentors, setMentors] = useState<Option[]>([]);
  const [mentees, setMentees] = useState<Option[]>([]);
  const [mentorId, setMentorId] = useState("");
  const [menteeId, setMenteeId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const load = async () => {
      const { data: mentorRows } = await supabase
        .from("user_organization_roles")
        .select("user_id, users(name,email)")
        .eq("organization_id", orgId)
        .eq("status", "active")
        .eq("role", "alumni");

      const { data: menteeRows } = await supabase
        .from("user_organization_roles")
        .select("user_id, users(name,email)")
        .eq("organization_id", orgId)
        .eq("status", "active")
        .eq("role", "active_member");

      setMentors(
        mentorRows?.map((row) => {
          const user = Array.isArray(row.users) ? row.users[0] : row.users;
          return {
            value: row.user_id,
            label: user?.name || user?.email || "Alumni",
          };
        }) || []
      );
      setMentees(
        menteeRows?.map((row) => {
          const user = Array.isArray(row.users) ? row.users[0] : row.users;
          return {
            value: row.user_id,
            label: user?.name || user?.email || "Member",
          };
        }) || []
      );
    };

    load();
  }, [orgId]);

  const handleCreate = async () => {
    if (!mentorId || !menteeId) {
      setError("Select both a mentor and mentee");
      return;
    }
    setIsSaving(true);
    setError(null);

    const supabase = createClient();
    const { error: insertError } = await supabase.from("mentorship_pairs").insert({
      organization_id: orgId,
      mentor_user_id: mentorId,
      mentee_user_id: menteeId,
      status: "active",
    });

    if (insertError) {
      setError(insertError.message);
      setIsSaving(false);
      return;
    }

    const mentorLabel = mentors.find((m) => m.value === mentorId)?.label || "Mentor";
    const menteeLabel = mentees.find((m) => m.value === menteeId)?.label || "Mentee";

    try {
      await fetch("/api/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: orgId,
          title: "New Mentorship Pairing",
          body: `You've been paired for mentorship.\n\nMentor: ${mentorLabel}\nMentee: ${menteeLabel}`,
          channel: "both",
          audience: "both",
          targetUserIds: [mentorId, menteeId],
        }),
      });
    } catch (notifError) {
      console.error("Failed to send mentorship pairing notification:", notifError);
    }

    window.location.href = `/${orgSlug}/mentorship`;
  };

  return (
    <Card className="p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-foreground">Create Pair</h3>
        <p className="text-sm text-muted-foreground">Pair an alumni mentor with an active member.</p>
      </div>
      {error && (
        <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Select
          label="Mentor (alumni)"
          value={mentorId}
          onChange={(e) => setMentorId(e.target.value)}
          options={[{ label: "Select mentor", value: "" }, ...mentors.map((m) => ({ label: m.label, value: m.value }))]}
        />
        <Select
          label="Mentee (active member)"
          value={menteeId}
          onChange={(e) => setMenteeId(e.target.value)}
          options={[{ label: "Select mentee", value: "" }, ...mentees.map((m) => ({ label: m.label, value: m.value }))]}
        />
      </div>
      <div className="flex justify-end">
        <Button onClick={handleCreate} isLoading={isSaving}>
          Create Pair
        </Button>
      </div>
    </Card>
  );
}
