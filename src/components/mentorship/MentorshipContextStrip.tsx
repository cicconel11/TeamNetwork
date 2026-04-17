"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button, Select, ToggleSwitch } from "@/components/ui";
import { getMentorshipStatusTranslationKey } from "@/lib/mentorship/presentation";
import {
  getPairableOrgMembers,
  memberDisplayLabel,
} from "@/lib/mentorship/queries";

type Option = { value: string; label: string };

interface MentorshipContextStripProps {
  role: "admin" | "alumni" | "active_member" | "parent" | string;
  orgId: string;
  orgSlug: string;
  myMentorName: string | null;
  myLastLogDate: string | null;
}

export function MentorshipContextStrip({
  role,
  orgId,
  orgSlug,
  myMentorName,
  myLastLogDate,
}: MentorshipContextStripProps) {
  // Parent / unknown roles get no strip at all.
  if (role !== "admin" && role !== "alumni" && role !== "active_member") {
    return null;
  }

  return (
    <div className="py-3 px-0 mb-2">
      {role === "admin" && <AdminStrip orgId={orgId} orgSlug={orgSlug} />}
      {role === "alumni" && <AlumniStrip orgId={orgId} orgSlug={orgSlug} />}
      {role === "active_member" && (
        <ActiveMemberStrip
          orgId={orgId}
          myMentorName={myMentorName}
          myLastLogDate={myLastLogDate}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

function AdminStrip({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const tMentorship = useTranslations("mentorship");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const [expanded, setExpanded] = useState(false);
  const [mentors, setMentors] = useState<Option[]>([]);
  const [mentees, setMentees] = useState<Option[]>([]);
  const [mentorId, setMentorId] = useState("");
  const [menteeId, setMenteeId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const safeT = (key: string, fallback: string) => {
    try {
      const v = tMentorship(key);
      return v || fallback;
    } catch {
      return fallback;
    }
  };

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    const supabase = createClient();
    const load = async () => {
      try {
        const { mentors: mentorList, mentees: menteeList } =
          await getPairableOrgMembers(supabase, orgId);
        if (cancelled) return;
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

    load();
    return () => {
      cancelled = true;
    };
  }, [expanded, orgId]);

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

    const mentorLabel =
      mentors.find((m) => m.value === mentorId)?.label || "Mentor";
    const menteeLabel =
      mentees.find((m) => m.value === menteeId)?.label || "Mentee";

    let notifyFailed = false;
    try {
      const res = await fetch("/api/notifications/send", {
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
      if (!res.ok) notifyFailed = true;
    } catch {
      notifyFailed = true;
    }

    if (notifyFailed) {
      toast.warning(tMentorship("pairCreatedNotifyFailed"));
    } else {
      toast.success(tMentorship("pairCreated"));
    }

    // Reset and refresh — router.refresh() keeps scroll position and preserves
    // layout chrome (unlike window.location.href, which does a full reload).
    // orgSlug is accepted as a prop to preserve the original widget signature
    // in case we ever need a hard fallback; currently unused on success.
    void orgSlug;
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
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            {tMentorship("pairMembers")}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {tMentorship("createPairDesc")}
          </p>
        </div>
        {!expanded && (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/${orgSlug}/mentorship/admin/matches`)}
              disabled={isSaving}
            >
              {safeT("runMatchRound", "Match queue")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setExpanded(true)}
              disabled={isSaving}
            >
              {tMentorship("createPair")}
            </Button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="space-y-3">
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label={tMentorship("mentorSelectLabel")}
              value={mentorId}
              onChange={(e) => setMentorId(e.target.value)}
              options={[
                { label: tMentorship("selectMentor"), value: "" },
                ...mentors,
              ]}
            />
            <Select
              label={tMentorship("menteeSelectLabel")}
              value={menteeId}
              onChange={(e) => setMenteeId(e.target.value)}
              options={[
                { label: tMentorship("selectMentee"), value: "" },
                ...mentees,
              ]}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(false)}
              disabled={isSaving}
            >
              {tCommon("cancel")}
            </Button>
            <Button size="sm" onClick={handleCreate} isLoading={isSaving}>
              {tMentorship("confirmPair")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Alumni                                                                     */
/* -------------------------------------------------------------------------- */

function AlumniStrip({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const tMentorship = useTranslations("mentorship");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mentorId, setMentorId] = useState<string | null>(null);
  const [mentorLabel, setMentorLabel] = useState("Mentor");
  const [pairId, setPairId] = useState<string | null>(null);
  const [currentMenteeId, setCurrentMenteeId] = useState<string | null>(null);
  const [currentMenteeLabel, setCurrentMenteeLabel] = useState<string | null>(
    null
  );
  const [initialMenteeId, setInitialMenteeId] = useState<string | null>(null);
  const [availableMentees, setAvailableMentees] = useState<Option[]>([]);
  const [status, setStatus] = useState<"active" | "completed" | "paused">(
    "active"
  );

  const statusOptions: Array<{
    label: string;
    value: "active" | "completed" | "paused";
  }> = [
    {
      label: tMentorship(getMentorshipStatusTranslationKey("active")),
      value: "active",
    },
    {
      label: tMentorship(getMentorshipStatusTranslationKey("paused")),
      value: "paused",
    },
    {
      label: tMentorship(getMentorshipStatusTranslationKey("completed")),
      value: "completed",
    },
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
        setError(tMentorship("signInManagePair"));
        setIsLoading(false);
        return;
      }
      setMentorId(user.id);
      setMentorLabel(
        (user.user_metadata?.name as string | undefined) ||
          user.email ||
          "Mentor"
      );

      let menteeOpts: Option[] = [];
      try {
        // Mentees are active members only, mirroring the admin strip rule.
        const { mentees: menteeList } = await getPairableOrgMembers(
          supabase,
          orgId
        );
        menteeOpts = menteeList.map((member) => ({
          value: member.user_id,
          label: memberDisplayLabel(member),
        }));
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load org members."
        );
        setIsLoading(false);
        return;
      }
      setAvailableMentees(menteeOpts);

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
          menteeOpts.find((m) => m.value === pair.mentee_user_id)?.label ?? null
        );
        const normalizedStatus =
          pair.status === "completed" || pair.status === "paused"
            ? pair.status
            : "active";
        setStatus(normalizedStatus);
      }

      setIsLoading(false);
    };

    load();
  }, [orgId, tMentorship]);

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
      : await supabase
          .from("mentorship_pairs")
          .insert(payload)
          .select("id")
          .maybeSingle();

    if (upsertError) {
      setError(upsertError.message);
      setIsSaving(false);
      return;
    }

    let notifyFailed = false;
    if (shouldNotify && mentorId && currentMenteeId) {
      const menteeLabel =
        availableMentees.find((m) => m.value === currentMenteeId)?.label ||
        "Mentee";
      try {
        const res = await fetch("/api/notifications/send", {
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
        if (!res.ok) notifyFailed = true;
      } catch {
        notifyFailed = true;
      }
    }

    if (shouldNotify && notifyFailed) {
      toast.warning(tMentorship("pairCreatedNotifyFailed"));
    } else if (shouldNotify) {
      toast.success(tMentorship("pairCreated"));
    } else {
      toast.success(tMentorship("pairCreated"));
    }

    void orgSlug;
    setPairId(data?.id ?? pairId);
    setInitialMenteeId(currentMenteeId);
    setCurrentMenteeLabel(
      availableMentees.find((m) => m.value === currentMenteeId)?.label ?? null
    );
    setExpanded(false);
    setIsSaving(false);
    router.refresh();
  };

  const handleRemove = async () => {
    if (!pairId || !mentorId) return;
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
    toast.success(tMentorship("removeMentee"));
    router.refresh();
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 text-muted-foreground">
        <div className="animate-spin h-5 w-5 border-4 border-current border-t-transparent rounded-full" />
        {tMentorship("loadingControls")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          {tMentorship("yourMentee")}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {currentMenteeLabel ?? tMentorship("noMenteeAssignedYet")}
        </p>
      </div>
      <div className="sm:text-right">
        <Button
          variant="ghost"
          onClick={() => setExpanded((v) => !v)}
          disabled={isSaving}
        >
          {pairId ? tMentorship("updateMentee") : tMentorship("assignMentee")}
        </Button>
      </div>

      {expanded && (
        <div className="w-full sm:basis-full space-y-3 pt-2">
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <Select
            label={tMentorship("menteeSelectLabel")}
            value={currentMenteeId || ""}
            onChange={(e) => setCurrentMenteeId(e.target.value || null)}
            options={[
              { label: tMentorship("selectMentee"), value: "" },
              ...availableMentees,
            ]}
          />

          <Select
            label={tCommon("status")}
            value={status}
            onChange={(e) =>
              setStatus(
                (e.target.value as "active" | "completed" | "paused") ||
                  "active"
              )
            }
            options={statusOptions}
          />

          <div className="flex items-center justify-end gap-2">
            {pairId && (
              <Button
                variant="ghost"
                onClick={handleRemove}
                disabled={isSaving}
              >
                {tMentorship("removeMentee")}
              </Button>
            )}
            <Button onClick={handleAssign} isLoading={isSaving}>
              {pairId
                ? tMentorship("updateMentee")
                : tMentorship("assignMentee")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Active member                                                              */
/* -------------------------------------------------------------------------- */

function ActiveMemberStrip({
  orgId,
  myMentorName,
  myLastLogDate,
}: {
  orgId: string;
  myMentorName: string | null;
  myLastLogDate: string | null;
}) {
  const tMentorship = useTranslations("mentorship");
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
        setError(tMentorship("signInManageAvailability"));
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

    load();
  }, [orgId, tMentorship]);

  const toggle = async (next: boolean) => {
    if (!userId || isSaving) return;
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
    toast.success(tMentorship("availabilityUpdated"));
    router.refresh();
  };

  const lastSessionText = myLastLogDate
    ? `${tMentorship("lastSession")}: ${new Date(
        myLastLogDate
      ).toLocaleDateString()}`
    : tMentorship("noSessionsYet");

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          {myMentorName
            ? `${tMentorship("myMentor")}: ${myMentorName}`
            : tMentorship("lookingForMentor")}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">{lastSessionText}</p>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 mt-2">{error}</p>
        )}
      </div>

      <div className="sm:text-right">
        <p className="text-xs font-medium text-muted-foreground mb-1">
          {tMentorship("availability")}
        </p>
        <div className="flex items-center gap-2 sm:justify-end">
          {isSaving && (
            <div
              aria-hidden="true"
              className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full"
            />
          )}
          <ToggleSwitch
            checked={status === "active"}
            onChange={toggle}
            disabled={isLoading || isSaving || status === null}
            label={tMentorship("availability")}
          />
          <span className="text-sm text-muted-foreground">
            {status === "active"
              ? tMentorship("currentlyAvailable")
              : tMentorship("currentlyUnavailable")}
          </span>
        </div>
      </div>
    </div>
  );
}
