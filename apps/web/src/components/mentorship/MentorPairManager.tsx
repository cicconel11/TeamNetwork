"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Select } from "@/components/ui";

type Option = { value: string; label: string };

interface MentorPairManagerProps {
  orgId: string;
  orgSlug: string;
}

export function MentorPairManager({ orgId, orgSlug }: MentorPairManagerProps) {
  const [mentorId, setMentorId] = useState<string | null>(null);
  const [currentMenteeId, setCurrentMenteeId] = useState<string | null>(null);
  const [availableMentees, setAvailableMentees] = useState<Option[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairId, setPairId] = useState<string | null>(null);
  const [mentorLabel, setMentorLabel] = useState("Mentor");
  const [initialMenteeId, setInitialMenteeId] = useState<string | null>(null);
  const [status, setStatus] = useState<"active" | "completed" | "paused">("active");

  const statusOptions: Array<{ label: string; value: "active" | "completed" | "paused" }> = [
    { label: "Active", value: "active" },
    { label: "Paused", value: "paused" },
    { label: "Completed", value: "completed" },
  ];

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError(null);
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("You must be signed in to manage your pair.");
        setIsLoading(false);
        return;
      }
      setMentorId(user.id);
      setMentorLabel(
        (user.user_metadata?.name as string | undefined) ||
          user.email ||
          "Mentor"
      );

      const { data: menteeRows, error: menteeError } = await supabase
        .from("user_organization_roles")
        .select("user_id, users(name,email)")
        .eq("organization_id", orgId)
        .eq("status", "active")
        .eq("role", "active_member");

      if (menteeError) {
        setError(menteeError.message);
        setIsLoading(false);
        return;
      }

      setAvailableMentees(
        menteeRows?.map((row) => {
          const userInfo = Array.isArray(row.users) ? row.users[0] : row.users;
          return { value: row.user_id, label: userInfo?.name || userInfo?.email || "Member" };
        }) || []
      );

      const { data: pair } = await supabase
        .from("mentorship_pairs")
        .select("*")
        .eq("organization_id", orgId)
        .eq("mentor_user_id", user.id)
        .maybeSingle();

      if (pair) {
        setPairId(pair.id);
        setCurrentMenteeId(pair.mentee_user_id);
        setInitialMenteeId(pair.mentee_user_id);
        const normalizedStatus =
          pair.status === "completed" || pair.status === "paused" ? pair.status : "active";
        setStatus(normalizedStatus);
      }

      setIsLoading(false);
    };

    load();
  }, [orgId]);

  const handleAssign = async () => {
    if (!mentorId || !currentMenteeId) {
      setError("Select a mentee to assign.");
      return;
    }

    const shouldNotify = !pairId || currentMenteeId !== initialMenteeId;

    setIsSaving(true);
    setError(null);
    const supabase = createClient();

    const payload = {
      organization_id: orgId,
      mentor_user_id: mentorId,
      mentee_user_id: currentMenteeId,
      status,
    };

    const { data, error: upsertError } = pairId
      ? await supabase
          .from("mentorship_pairs")
          .update(payload)
          .eq("id", pairId)
          .eq("mentor_user_id", mentorId)
          .select("id")
          .maybeSingle()
      : await supabase.from("mentorship_pairs").insert(payload).select("id").maybeSingle();

    if (upsertError) {
      setError(upsertError.message);
      setIsSaving(false);
      return;
    }

    if (shouldNotify && mentorId && currentMenteeId) {
      const menteeLabel = availableMentees.find((m) => m.value === currentMenteeId)?.label || "Mentee";
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
            targetUserIds: [mentorId, currentMenteeId],
          }),
        });
      } catch (notifError) {
        console.error("Failed to send mentorship pairing notification:", notifError);
      }
    }

    setPairId(data?.id ?? pairId);
    setIsSaving(false);
    window.location.href = `/${orgSlug}/mentorship`;
  };

  const handleRemove = async () => {
    if (!pairId || !mentorId) return;
    setIsSaving(true);
    setError(null);
    const supabase = createClient();

    const { error: deleteError } = await supabase
      .from("mentorship_pairs")
      .delete()
      .eq("id", pairId)
      .eq("mentor_user_id", mentorId);

    if (deleteError) {
      setError(deleteError.message);
      setIsSaving(false);
      return;
    }

    setPairId(null);
    setCurrentMenteeId(null);
    setIsSaving(false);
    window.location.href = `/${orgSlug}/mentorship`;
  };

  if (isLoading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="animate-spin h-5 w-5 border-4 border-org-primary border-t-transparent rounded-full" />
          Loading your mentorship controls...
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-foreground">Manage your mentee</h3>
        <p className="text-sm text-muted-foreground">
          Assign or remove your mentee. Changes apply only to your own pairing.
        </p>
      </div>

      {error && (
        <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <Select
        label="Mentee (active member)"
        value={currentMenteeId || ""}
        onChange={(e) => setCurrentMenteeId(e.target.value || null)}
        options={[{ label: "Select mentee", value: "" }, ...availableMentees]}
      />

      <Select
        label="Status"
        value={status}
        onChange={(e) => setStatus((e.target.value as "active" | "completed" | "paused") || "active")}
        options={statusOptions}
      />

      <div className="flex items-center justify-end gap-3">
        {pairId && (
          <Button variant="ghost" onClick={handleRemove} disabled={isSaving}>
            Remove mentee
          </Button>
        )}
        <Button onClick={handleAssign} isLoading={isSaving}>
          {pairId ? "Update mentee" : "Assign mentee"}
        </Button>
      </div>
    </Card>
  );
}
