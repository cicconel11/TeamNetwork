"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Select, ToggleSwitch } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { getPairableOrgMembers, memberDisplayLabel } from "@/lib/mentorship/queries";
import { normalizeMentorshipStatus } from "@teammeet/core";

type Option = { value: string; label: string };

interface MentorshipContextStripProps {
  role: "admin" | "alumni" | "active_member" | "parent" | string;
  orgId: string;
  myMentorName: string | null;
  myLastLogDate: string | null;
}

export function MentorshipContextStrip({
  role,
  orgId,
  myMentorName,
  myLastLogDate,
}: MentorshipContextStripProps) {
  if (role !== "admin" && role !== "alumni" && role !== "active_member") {
    return null;
  }

  return (
    <Card className="p-5 border-l-4 border-[color:var(--color-org-secondary)]">
      {role === "admin" && <AdminStrip orgId={orgId} />}
      {role === "alumni" && <AlumniStrip orgId={orgId} />}
      {role === "active_member" && (
        <ActiveMemberStrip
          orgId={orgId}
          myMentorName={myMentorName}
          myLastLogDate={myLastLogDate}
        />
      )}
    </Card>
  );
}

function AdminStrip({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [mentors, setMentors] = useState<Option[]>([]);
  const [mentees, setMentees] = useState<Option[]>([]);
  const [mentorId, setMentorId] = useState("");
  const [menteeId, setMenteeId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded) {
      return;
    }

    let cancelled = false;
    const supabase = createClient();

    const load = async () => {
      try {
        const { mentors: mentorList, mentees: menteeList } =
          await getPairableOrgMembers(supabase, orgId);

        if (cancelled) {
          return;
        }

        setMentors(
          mentorList.map((member) => ({
            value: member.user_id,
            label: memberDisplayLabel(member),
          }))
        );
        setMentees(
          menteeList.map((member) => ({
            value: member.user_id,
            label: memberDisplayLabel(member),
          }))
        );
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load org members."
          );
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [expanded, orgId]);

  const handleCreate = async () => {
    if (!mentorId || !menteeId) {
      setError("Select both a mentor and mentee.");
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

    const mentorLabel = mentors.find((member) => member.value === mentorId)?.label || "Mentor";
    const menteeLabel = mentees.find((member) => member.value === menteeId)?.label || "Mentee";

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
    } catch {
      // Notification failures are non-blocking for pair creation.
    }

    setMentorId("");
    setMenteeId("");
    setExpanded(false);
    setIsSaving(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-xl font-semibold text-foreground">
            Pair members
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Create a mentorship pair using active org members.
          </p>
        </div>
        {!expanded && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setExpanded(true)}
            disabled={isSaving}
          >
            Create a pair
          </Button>
        )}
      </div>

      {expanded && (
        <div className="space-y-3">
          {error && (
            <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Mentor"
              value={mentorId}
              onChange={(event) => setMentorId(event.target.value)}
              options={[{ label: "Select mentor", value: "" }, ...mentors]}
            />
            <Select
              label="Mentee"
              value={menteeId}
              onChange={(event) => setMenteeId(event.target.value)}
              options={[{ label: "Select mentee", value: "" }, ...mentees]}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} isLoading={isSaving}>
              Confirm pair
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AlumniStrip({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mentorId, setMentorId] = useState<string | null>(null);
  const [mentorLabel, setMentorLabel] = useState("Mentor");
  const [pairId, setPairId] = useState<string | null>(null);
  const [currentMenteeId, setCurrentMenteeId] = useState<string | null>(null);
  const [currentMenteeLabel, setCurrentMenteeLabel] = useState<string | null>(null);
  const [initialMenteeId, setInitialMenteeId] = useState<string | null>(null);
  const [availableMentees, setAvailableMentees] = useState<Option[]>([]);
  const [status, setStatus] = useState<"active" | "completed" | "paused">("active");

  const statusOptions: Array<{ label: string; value: "active" | "completed" | "paused" }> = [
    { label: "Active", value: "active" },
    { label: "Paused", value: "paused" },
    { label: "Completed", value: "completed" },
  ];

  useEffect(() => {
    const supabase = createClient();

    const load = async () => {
      setIsLoading(true);
      setError(null);

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
        (user.user_metadata?.name as string | undefined) || user.email || "Mentor"
      );

      let menteeOptions: Option[] = [];
      try {
        const { mentees: menteeList } = await getPairableOrgMembers(supabase, orgId);
        menteeOptions = menteeList.map((member) => ({
          value: member.user_id,
          label: memberDisplayLabel(member),
        }));
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : "Unable to load org members."
        );
        setIsLoading(false);
        return;
      }

      setAvailableMentees(menteeOptions);

      const { data: pair } = await supabase
        .from("mentorship_pairs")
        .select("*")
        .eq("organization_id", orgId)
        .eq("mentor_user_id", user.id)
        .is("deleted_at", null)
        .maybeSingle();

      if (pair) {
        setPairId(pair.id);
        setCurrentMenteeId(pair.mentee_user_id);
        setInitialMenteeId(pair.mentee_user_id);
        setCurrentMenteeLabel(
          menteeOptions.find((member) => member.value === pair.mentee_user_id)?.label ?? null
        );
        setStatus(normalizeMentorshipStatus(pair.status));
      }

      setIsLoading(false);
    };

    void load();
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
          .is("deleted_at", null)
          .select("id")
          .maybeSingle()
      : await supabase.from("mentorship_pairs").insert(payload).select("id").maybeSingle();

    if (upsertError) {
      setError(upsertError.message);
      setIsSaving(false);
      return;
    }

    if (shouldNotify) {
      const menteeLabel =
        availableMentees.find((member) => member.value === currentMenteeId)?.label || "Mentee";
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
      } catch {
        // Notification failures are non-blocking for pair creation.
      }
    }

    void orgSlug;
    setPairId(data?.id ?? pairId);
    setInitialMenteeId(currentMenteeId);
    setCurrentMenteeLabel(
      availableMentees.find((member) => member.value === currentMenteeId)?.label ?? null
    );
    setExpanded(false);
    setIsSaving(false);
    router.refresh();
  };

  const handleRemove = async () => {
    if (!pairId || !mentorId) {
      return;
    }

    setIsSaving(true);
    setError(null);
    const supabase = createClient();

    const { error: deleteError } = await supabase
      .from("mentorship_pairs")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", pairId)
      .eq("mentor_user_id", mentorId)
      .is("deleted_at", null);

    if (deleteError) {
      setError(deleteError.message);
      setIsSaving(false);
      return;
    }

    setPairId(null);
    setCurrentMenteeId(null);
    setCurrentMenteeLabel(null);
    setInitialMenteeId(null);
    setExpanded(false);
    setIsSaving(false);
    router.refresh();
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 text-muted-foreground">
        <div className="animate-spin h-5 w-5 border-4 border-org-primary border-t-transparent rounded-full" />
        Loading your mentorship controls...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h3 className="font-display text-xl font-semibold text-foreground">
          Your mentee
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {currentMenteeLabel ?? "No mentee assigned yet"}
        </p>
      </div>
      <div className="sm:text-right">
        <Button
          variant="ghost"
          onClick={() => setExpanded((value) => !value)}
          disabled={isSaving}
        >
          {pairId ? "Update mentee" : "Assign mentee"}
        </Button>
      </div>

      {expanded && (
        <div className="w-full sm:basis-full space-y-3 pt-2">
          {error && (
            <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <Select
            label="Mentee"
            value={currentMenteeId || ""}
            onChange={(event) => setCurrentMenteeId(event.target.value || null)}
            options={[{ label: "Select mentee", value: "" }, ...availableMentees]}
          />

          <Select
            label="Status"
            value={status}
            onChange={(event) =>
              setStatus(
                (event.target.value as "active" | "completed" | "paused") || "active"
              )
            }
            options={statusOptions}
          />

          <div className="flex items-center justify-end gap-2">
            {pairId && (
              <Button variant="ghost" onClick={handleRemove} disabled={isSaving}>
                Remove mentee
              </Button>
            )}
            <Button onClick={handleAssign} isLoading={isSaving}>
              {pairId ? "Update mentee" : "Assign mentee"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ActiveMemberStrip({
  orgId,
  myMentorName,
  myLastLogDate,
}: {
  orgId: string;
  myMentorName: string | null;
  myLastLogDate: string | null;
}) {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [status, setStatus] = useState<"active" | "revoked" | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const load = async () => {
      setIsLoading(true);
      setError(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError("Sign in to manage your mentee availability.");
        setIsLoading(false);
        return;
      }

      setUserId(user.id);

      const { data: membership, error: fetchError } = await supabase
        .from("user_organization_roles")
        .select("status, role")
        .eq("organization_id", orgId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (fetchError) {
        setError(fetchError.message);
        setIsLoading(false);
        return;
      }

      if (!membership || membership.role !== "active_member") {
        setIsLoading(false);
        return;
      }

      setStatus((membership.status as "active" | "revoked") ?? "active");
      setIsLoading(false);
    };

    void load();
  }, [orgId]);

  const toggle = async (next: boolean) => {
    if (!userId || isSaving) {
      return;
    }

    const nextStatus: "active" | "revoked" = next ? "active" : "revoked";
    setIsSaving(true);
    setError(null);
    const supabase = createClient();

    const { error: updateError } = await supabase
      .from("user_organization_roles")
      .update({ status: nextStatus })
      .eq("organization_id", orgId)
      .eq("user_id", userId);

    if (updateError) {
      setError(updateError.message);
      setIsSaving(false);
      return;
    }

    setStatus(nextStatus);
    setIsSaving(false);
    router.refresh();
  };

  const lastSessionText = myLastLogDate
    ? `Last session: ${new Date(myLastLogDate).toLocaleDateString()}`
    : "No sessions logged yet";

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h3 className="font-display text-xl font-semibold text-foreground">
          {myMentorName ? `My mentor: ${myMentorName}` : "Looking for a mentor"}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">{lastSessionText}</p>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 mt-2">{error}</p>
        )}
      </div>

      <div className="sm:text-right">
        <p className="text-xs font-medium text-muted-foreground mb-1">
          Availability
        </p>
        <div className="flex items-center gap-2 sm:justify-end">
          <ToggleSwitch
            checked={status === "active"}
            onChange={toggle}
            disabled={isLoading || isSaving || status === null}
            label="Availability"
          />
          <span className="text-sm text-muted-foreground">
            {status === "active" ? "Currently available" : "Currently unavailable"}
          </span>
        </div>
      </div>
    </div>
  );
}
