"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
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

const DEFAULT_MEETING_MINUTES = 30;
const MEETING_PRESETS = [15, 30, 45, 60, 90];

function parseMeetingMinutes(raw: string): number {
  const match = raw.match(/(\d{1,3})/);
  if (!match) return DEFAULT_MEETING_MINUTES;
  const n = parseInt(match[1], 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MEETING_MINUTES;
  return Math.min(240, n);
}

function formatMeetingMinutes(minutes: number): string {
  return `${minutes} minutes`;
}

export function MentorProfileCard({ orgId }: MentorProfileCardProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hasRow, setHasRow] = useState(false);
  const [form, setForm] = useState<Profile>(EMPTY);
  const [meetingMinutes, setMeetingMinutes] = useState<number>(DEFAULT_MEETING_MINUTES);

  const hydrate = useCallback((p: Profile) => {
    setForm(p);
    setMeetingMinutes(
      p.time_commitment ? parseMeetingMinutes(p.time_commitment) : DEFAULT_MEETING_MINUTES
    );
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
          suggested?: {
            bio?: string | null;
            industries?: string[];
            role_families?: string[];
            positions?: string[];
          } | null;
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
        } else if (json.suggested) {
          hydrate({
            ...EMPTY,
            bio: json.suggested.bio ?? "",
            industries: json.suggested.industries ?? [],
            role_families: json.suggested.role_families ?? [],
            positions: json.suggested.positions ?? [],
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
        time_commitment: formatMeetingMinutes(meetingMinutes),
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

  if (loading) return null;

  if (hasRow && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
      >
        Edit mentor profile
      </button>
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
        <div className="space-y-5 pt-3 border-t border-[var(--border)]">
          <Field label="Bio" hint="A few sentences about who you are and how you can help.">
            <Textarea
              value={form.bio}
              onChange={(e) => setForm((p) => ({ ...p, bio: e.target.value }))}
              placeholder="Short intro — your background, what you can help with."
              rows={3}
              maxLength={2000}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Expertise" hint="Skills, domains, or tools you're strong in.">
              <ChipInput
                values={form.expertise_areas}
                onChange={(v) => setForm((p) => ({ ...p, expertise_areas: v }))}
                placeholder="Type and press Enter"
              />
            </Field>
            <Field label="Topics" hint="Conversations you're happy to have.">
              <ChipInput
                values={form.topics}
                onChange={(v) => setForm((p) => ({ ...p, topics: v }))}
                placeholder="Type and press Enter"
              />
            </Field>
            <Field label="Sports" hint="Sports you've played or coached.">
              <ChipInput
                values={form.sports}
                onChange={(v) => setForm((p) => ({ ...p, sports: v }))}
                placeholder="Type and press Enter"
              />
            </Field>
            <Field label="Positions" hint="Positions you played.">
              <ChipInput
                values={form.positions}
                onChange={(v) => setForm((p) => ({ ...p, positions: v }))}
                placeholder="Type and press Enter"
              />
            </Field>
            <Field label="Industries" hint="Industries you've worked in.">
              <ChipInput
                values={form.industries}
                onChange={(v) => setForm((p) => ({ ...p, industries: v }))}
                placeholder="Type and press Enter"
              />
            </Field>
            <Field label="Job fields" hint="Functional areas you've worked in.">
              <ChipInput
                values={form.role_families}
                onChange={(v) => setForm((p) => ({ ...p, role_families: v }))}
                placeholder="Type and press Enter"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Max mentees">
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
            </Field>
            <Field label="Meeting length" hint="Minutes per mentorship session.">
              <MeetingLengthPicker
                value={meetingMinutes}
                onChange={setMeetingMinutes}
              />
            </Field>
            <Field label="Years of experience">
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
            </Field>
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

          <Field label="Meeting preferences" hint="How you'd like to connect.">
            <div className="flex flex-wrap gap-2">
              {COMMS.map((c) => {
                const on = form.meeting_preferences.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleComm(c)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      on
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                        : "bg-transparent border-[var(--border)] hover:border-foreground/60"
                    }`}
                  >
                    {c.replace("_", " ")}
                  </button>
                );
              })}
            </div>
          </Field>

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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-col gap-0.5">
        <label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          {label}
        </label>
        {hint && <span className="text-[11px] text-[var(--muted-foreground)]/80">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function MeetingLengthPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  const isPreset = MEETING_PRESETS.includes(value);
  const [custom, setCustom] = useState(!isPreset);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {MEETING_PRESETS.map((m) => {
          const active = !custom && value === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => {
                setCustom(false);
                onChange(m);
              }}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                active
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                  : "bg-transparent border-[var(--border)] hover:border-foreground/60"
              }`}
            >
              {m}m
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setCustom(true)}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
            custom
              ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
              : "bg-transparent border-[var(--border)] hover:border-foreground/60"
          }`}
        >
          Custom
        </button>
      </div>
      {custom && (
        <Input
          type="number"
          min={5}
          max={240}
          value={value}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (Number.isFinite(n)) onChange(Math.max(5, Math.min(240, n)));
          }}
        />
      )}
    </div>
  );
}

function ChipInput({
  values,
  onChange,
  placeholder,
  maxItems = 20,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  maxItems?: number;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = useCallback(
    (raw: string) => {
      const value = raw.trim();
      if (!value) return;
      if (value.length > 60) return;
      const exists = values.some((v) => v.toLowerCase() === value.toLowerCase());
      if (exists) {
        setDraft("");
        return;
      }
      if (values.length >= maxItems) return;
      onChange([...values, value]);
      setDraft("");
    },
    [values, onChange, maxItems]
  );

  const remove = (idx: number) => {
    onChange(values.filter((_, i) => i !== idx));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && !draft && values.length > 0) {
      remove(values.length - 1);
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text.includes(",")) return;
    e.preventDefault();
    const parts = text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const next = [...values];
    for (const p of parts) {
      if (next.length >= maxItems) break;
      if (next.some((v) => v.toLowerCase() === p.toLowerCase())) continue;
      if (p.length > 60) continue;
      next.push(p);
    }
    onChange(next);
    setDraft("");
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] min-h-[38px] focus-within:ring-2 focus-within:ring-[var(--ring)]/40"
      onClick={() => inputRef.current?.focus()}
    >
      {values.map((v, i) => (
        <span
          key={`${v}-${i}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--muted)] text-xs text-foreground"
        >
          {v}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              remove(i);
            }}
            className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-[var(--border)] transition-colors"
            aria-label={`Remove ${v}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => commit(draft)}
        placeholder={values.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[100px] bg-transparent text-sm text-foreground outline-none placeholder:text-[var(--muted-foreground)]"
      />
    </div>
  );
}
