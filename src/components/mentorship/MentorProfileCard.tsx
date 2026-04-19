"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, Input, Textarea, ToggleSwitch } from "@/components/ui";

type Profile = {
  bio: string;
  expertise_areas: string[];
  topics: string[];
  sports: string[];
  positions: string[];
  industries: string[];
  role_families: string[];
  max_mentees: number;
  accepting_new: boolean;
  meeting_preferences: Array<"video" | "phone" | "in_person" | "async">;
  time_commitment: string;
  years_of_experience: number | null;
};

interface MentorProfileCardProps {
  orgId: string;
}

const EMPTY: Profile = {
  bio: "",
  expertise_areas: [],
  topics: [],
  sports: [],
  positions: [],
  industries: [],
  role_families: [],
  max_mentees: 3,
  accepting_new: true,
  meeting_preferences: [],
  time_commitment: "",
  years_of_experience: null,
};

const COMMS: Array<"video" | "phone" | "in_person" | "async"> = [
  "video",
  "phone",
  "in_person",
  "async",
];

function parseCsv(s: string): string[] {
  return s
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function joinCsv(arr: string[]): string {
  return arr.join(", ");
}

export function MentorProfileCard({ orgId }: MentorProfileCardProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hasRow, setHasRow] = useState(false);
  const [form, setForm] = useState<Profile>(EMPTY);

  const [expertiseText, setExpertiseText] = useState("");
  const [topicsText, setTopicsText] = useState("");
  const [sportsText, setSportsText] = useState("");
  const [positionsText, setPositionsText] = useState("");
  const [industriesText, setIndustriesText] = useState("");
  const [rolesText, setRolesText] = useState("");

  const hydrate = useCallback((p: Profile) => {
    setForm(p);
    setExpertiseText(joinCsv(p.expertise_areas));
    setTopicsText(joinCsv(p.topics));
    setSportsText(joinCsv(p.sports));
    setPositionsText(joinCsv(p.positions));
    setIndustriesText(joinCsv(p.industries));
    setRolesText(joinCsv(p.role_families));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/organizations/${orgId}/mentorship/mentor-profile`,
          { method: "GET" }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          profile:
            | (Partial<Profile> & { id?: string; years_of_experience?: number | null })
            | null;
        };
        if (cancelled) return;
        if (json.profile) {
          setHasRow(true);
          hydrate({
            bio: json.profile.bio ?? "",
            expertise_areas: json.profile.expertise_areas ?? [],
            topics: json.profile.topics ?? [],
            sports: json.profile.sports ?? [],
            positions: json.profile.positions ?? [],
            industries: json.profile.industries ?? [],
            role_families: json.profile.role_families ?? [],
            max_mentees: json.profile.max_mentees ?? 3,
            accepting_new: json.profile.accepting_new ?? true,
            meeting_preferences: (json.profile.meeting_preferences ?? []) as Profile["meeting_preferences"],
            time_commitment: json.profile.time_commitment ?? "",
            years_of_experience: json.profile.years_of_experience ?? null,
          });
        }
      } catch {
        if (!cancelled) toast.error("Failed to load mentor profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, hydrate]);

  const toggleComm = (key: (typeof COMMS)[number]) => {
    setForm((prev) => ({
      ...prev,
      meeting_preferences: prev.meeting_preferences.includes(key)
        ? prev.meeting_preferences.filter((k) => k !== key)
        : [...prev.meeting_preferences, key],
    }));
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const body = {
        ...form,
        expertise_areas: parseCsv(expertiseText),
        topics: parseCsv(topicsText),
        sports: parseCsv(sportsText),
        positions: parseCsv(positionsText),
        industries: parseCsv(industriesText),
        role_families: parseCsv(rolesText),
      };
      const res = await fetch(
        `/api/organizations/${orgId}/mentorship/mentor-profile`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        profile: Partial<Profile> & { years_of_experience?: number | null };
      };
      hydrate({
        bio: json.profile.bio ?? "",
        expertise_areas: json.profile.expertise_areas ?? [],
        topics: json.profile.topics ?? [],
        sports: json.profile.sports ?? [],
        positions: json.profile.positions ?? [],
        industries: json.profile.industries ?? [],
        role_families: json.profile.role_families ?? [],
        max_mentees: json.profile.max_mentees ?? 3,
        accepting_new: json.profile.accepting_new ?? true,
        meeting_preferences: (json.profile.meeting_preferences ?? []) as Profile["meeting_preferences"],
        time_commitment: json.profile.time_commitment ?? "",
        years_of_experience: json.profile.years_of_experience ?? null,
      });
      setHasRow(true);
      setExpanded(false);
      toast.success("Mentor profile saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-md border border-[var(--border)] bg-[var(--muted)]/30 p-4 text-sm text-[var(--muted-foreground)]">
        Loading your mentor profile…
      </div>
    );
  }

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--muted)]/30 p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            {hasRow ? "Your mentor profile" : "Become a mentor"}
          </h3>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            {hasRow
              ? "Keep your profile up to date to attract the right mentees."
              : "Share your background so mentees can find you."}
          </p>
        </div>
        <Button size="sm" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Close" : hasRow ? "Edit" : "Get started"}
        </Button>
      </div>

      {expanded && (
        <div className="space-y-4 pt-2 border-t border-[var(--border)]">
          <div>
            <label className="block text-xs font-medium mb-1">Bio</label>
            <Textarea
              value={form.bio}
              onChange={(e) => setForm((p) => ({ ...p, bio: e.target.value }))}
              placeholder="Short intro — your background, what you can help with."
              rows={3}
              maxLength={2000}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">
                Expertise (comma-separated)
              </label>
              <Input
                value={expertiseText}
                onChange={(e) => setExpertiseText(e.target.value)}
                placeholder="React, engineering leadership"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                Topics (comma-separated)
              </label>
              <Input
                value={topicsText}
                onChange={(e) => setTopicsText(e.target.value)}
                placeholder="leadership, recruiting"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                Sports (comma-separated)
              </label>
              <Input
                value={sportsText}
                onChange={(e) => setSportsText(e.target.value)}
                placeholder="basketball, football"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                Positions (comma-separated)
              </label>
              <Input
                value={positionsText}
                onChange={(e) => setPositionsText(e.target.value)}
                placeholder="point-guard, quarterback"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                Industries (comma-separated)
              </label>
              <Input
                value={industriesText}
                onChange={(e) => setIndustriesText(e.target.value)}
                placeholder="Technology, Finance"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                Job fields (comma-separated)
              </label>
              <Input
                value={rolesText}
                onChange={(e) => setRolesText(e.target.value)}
                placeholder="Engineering, Product"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Max mentees</label>
              <Input
                type="number"
                min={0}
                max={100}
                value={form.max_mentees}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    max_mentees: Number.isFinite(Number(e.target.value))
                      ? Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0))
                      : p.max_mentees,
                  }))
                }
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Time commitment</label>
              <Input
                value={form.time_commitment}
                onChange={(e) =>
                  setForm((p) => ({ ...p, time_commitment: e.target.value }))
                }
                placeholder="e.g. 1hr/month, flexible"
                maxLength={100}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Years of experience</label>
              <Input
                type="number"
                min={0}
                max={80}
                value={form.years_of_experience ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((p) => ({
                    ...p,
                    years_of_experience:
                      v === ""
                        ? null
                        : Math.max(0, Math.min(80, parseInt(v, 10) || 0)),
                  }));
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ToggleSwitch
              checked={form.accepting_new}
              onChange={(checked) =>
                setForm((p) => ({ ...p, accepting_new: checked }))
              }
              label="Accepting new mentees"
            />
          </div>

          <div>
            <div className="text-xs font-medium mb-1">Meeting preferences</div>
            <div className="flex flex-wrap gap-2">
              {COMMS.map((c) => {
                const on = form.meeting_preferences.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleComm(c)}
                    className={`text-xs px-2 py-1 rounded-md border ${
                      on
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                        : "bg-transparent border-[var(--border)]"
                    }`}
                  >
                    {c.replace("_", " ")}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setExpanded(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={onSave} disabled={saving}>
              {saving ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
