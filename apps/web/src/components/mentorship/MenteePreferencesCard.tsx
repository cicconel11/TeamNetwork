"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, Input, Select, Textarea, ToggleSwitch } from "@/components/ui";

type Preferences = {
  goals: string;
  seeking_mentorship: boolean;
  preferred_topics: string[];
  preferred_industries: string[];
  preferred_role_families: string[];
  preferred_sports: string[];
  preferred_positions: string[];
  required_attributes: string[];
  nice_to_have_attributes: string[];
  time_availability: string;
  communication_prefs: string[];
  geographic_pref: string;
};

interface MenteePreferencesCardProps {
  orgId: string;
}

const EMPTY: Preferences = {
  goals: "",
  seeking_mentorship: false,
  preferred_topics: [],
  preferred_industries: [],
  preferred_role_families: [],
  preferred_sports: [],
  preferred_positions: [],
  required_attributes: [],
  nice_to_have_attributes: [],
  time_availability: "",
  communication_prefs: [],
  geographic_pref: "",
};

const TIME_OPTIONS = [
  { value: "", label: "Select availability…" },
  { value: "1hr/month", label: "1 hour / month" },
  { value: "2hr/month", label: "2 hours / month" },
  { value: "4hr/month", label: "4 hours / month" },
  { value: "flexible", label: "Flexible" },
];

const COMMS: Array<"video" | "phone" | "in_person" | "async"> = [
  "video",
  "phone",
  "in_person",
  "async",
];

const ATTRS = [
  { key: "same_sport", label: "Same sport" },
  { key: "same_position", label: "Same position" },
  { key: "same_industry", label: "Same industry" },
  { key: "same_role_family", label: "Same job field" },
  { key: "alumni_of_org", label: "Alumni of this org" },
  { key: "local", label: "Local" },
  { key: "female", label: "Female" },
  { key: "veteran", label: "Veteran" },
  { key: "first_gen", label: "First-gen" },
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

export function MenteePreferencesCard({ orgId }: MenteePreferencesCardProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hasRow, setHasRow] = useState(false);
  const [form, setForm] = useState<Preferences>(EMPTY);
  // CSV buffers keep the text input responsive while the user types commas/spaces.
  const [topicsText, setTopicsText] = useState("");
  const [industriesText, setIndustriesText] = useState("");
  const [roleFamiliesText, setRoleFamiliesText] = useState("");
  const [sportsText, setSportsText] = useState("");
  const [positionsText, setPositionsText] = useState("");

  const hydrate = useCallback((p: Preferences) => {
    setForm(p);
    setTopicsText(joinCsv(p.preferred_topics));
    setIndustriesText(joinCsv(p.preferred_industries));
    setRoleFamiliesText(joinCsv(p.preferred_role_families));
    setSportsText(joinCsv(p.preferred_sports));
    setPositionsText(joinCsv(p.preferred_positions));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/organizations/${orgId}/mentorship/preferences`,
          { method: "GET" }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          preferences: (Partial<Preferences> & { id?: string }) | null;
        };
        if (cancelled) return;
        if (json.preferences) {
          setHasRow(true);
          hydrate({
            goals: json.preferences.goals ?? "",
            seeking_mentorship: json.preferences.seeking_mentorship ?? false,
            preferred_topics: json.preferences.preferred_topics ?? [],
            preferred_industries: json.preferences.preferred_industries ?? [],
            preferred_role_families: json.preferences.preferred_role_families ?? [],
            preferred_sports: json.preferences.preferred_sports ?? [],
            preferred_positions: json.preferences.preferred_positions ?? [],
            required_attributes: json.preferences.required_attributes ?? [],
            nice_to_have_attributes: json.preferences.nice_to_have_attributes ?? [],
            time_availability: json.preferences.time_availability ?? "",
            communication_prefs: json.preferences.communication_prefs ?? [],
            geographic_pref: json.preferences.geographic_pref ?? "",
          });
        }
      } catch {
        if (!cancelled) toast.error("Failed to load preferences");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, hydrate]);

  const toggleAttr = (list: keyof Preferences, key: string) => {
    setForm((prev) => {
      const current = prev[list] as string[];
      const next = current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key];
      return { ...prev, [list]: next };
    });
  };

  const toggleComm = (key: (typeof COMMS)[number]) => {
    setForm((prev) => ({
      ...prev,
      communication_prefs: prev.communication_prefs.includes(key)
        ? prev.communication_prefs.filter((k) => k !== key)
        : [...prev.communication_prefs, key],
    }));
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const body: Preferences = {
        ...form,
        preferred_topics: parseCsv(topicsText),
        preferred_industries: parseCsv(industriesText),
        preferred_role_families: parseCsv(roleFamiliesText),
        preferred_sports: parseCsv(sportsText),
        preferred_positions: parseCsv(positionsText),
      };
      const res = await fetch(
        `/api/organizations/${orgId}/mentorship/preferences`,
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
      const json = (await res.json()) as { preferences: Partial<Preferences> };
      hydrate({
        goals: json.preferences.goals ?? "",
        seeking_mentorship: json.preferences.seeking_mentorship ?? false,
        preferred_topics: json.preferences.preferred_topics ?? [],
        preferred_industries: json.preferences.preferred_industries ?? [],
        preferred_role_families: json.preferences.preferred_role_families ?? [],
        preferred_sports: json.preferences.preferred_sports ?? [],
        preferred_positions: json.preferences.preferred_positions ?? [],
        required_attributes: json.preferences.required_attributes ?? [],
        nice_to_have_attributes: json.preferences.nice_to_have_attributes ?? [],
        time_availability: json.preferences.time_availability ?? "",
        communication_prefs: json.preferences.communication_prefs ?? [],
        geographic_pref: json.preferences.geographic_pref ?? "",
      });
      setHasRow(true);
      setExpanded(false);
      toast.success("Preferences saved");
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
        {form.seeking_mentorship
          ? "Edit mentorship preferences"
          : "Looking for a mentor? Edit your preferences"}
      </button>
    );
  }

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--muted)]/30 p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Your mentorship preferences
          </h3>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            {hasRow
              ? "Edit your preferences to refine matches."
              : "Tell us who you want to learn from so we can match you."}
          </p>
        </div>
        <Button size="sm" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Close" : hasRow ? "Edit" : "Get started"}
        </Button>
      </div>

      {expanded && (
        <div className="space-y-4 pt-2 border-t border-[var(--border)]">
          <div className="flex items-start gap-3 rounded-md border border-[var(--border)] bg-[var(--card)]/60 p-3">
            <ToggleSwitch
              checked={form.seeking_mentorship}
              onChange={(checked) =>
                setForm((p) => ({ ...p, seeking_mentorship: checked }))
              }
              label="Looking for a mentor"
            />
            <p className="text-xs text-[var(--muted-foreground)] pt-0.5">
              Turn this on to appear to mentors and the matching engine. Turn off any time to pause.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Your mentorship goals</label>
            <Textarea
              value={form.goals}
              onChange={(e) =>
                setForm((p) => ({ ...p, goals: e.target.value }))
              }
              placeholder="What do you hope to get out of mentorship?"
              rows={3}
              maxLength={2000}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">
                Topics (comma-separated)
              </label>
              <Input
                value={topicsText}
                onChange={(e) => setTopicsText(e.target.value)}
                placeholder="leadership, finance, recruiting"
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
                value={roleFamiliesText}
                onChange={(e) => setRoleFamiliesText(e.target.value)}
                placeholder="Engineering, Product"
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
                Geographic preference
              </label>
              <Input
                value={form.geographic_pref}
                onChange={(e) =>
                  setForm((p) => ({ ...p, geographic_pref: e.target.value }))
                }
                placeholder="NYC, remote, etc."
                maxLength={200}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Time availability</label>
            <Select
              value={form.time_availability}
              onChange={(e) =>
                setForm((p) => ({ ...p, time_availability: e.target.value }))
              }
              options={TIME_OPTIONS}
            />
          </div>

          <div>
            <div className="text-xs font-medium mb-1">Communication preferences</div>
            <div className="flex flex-wrap gap-2">
              {COMMS.map((c) => {
                const on = form.communication_prefs.includes(c);
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

          <div>
            <div className="text-xs font-medium mb-1">Must-have mentor attributes</div>
            <div className="flex flex-wrap gap-2">
              {ATTRS.map((a) => {
                const on = form.required_attributes.includes(a.key);
                return (
                  <button
                    key={a.key}
                    type="button"
                    onClick={() => toggleAttr("required_attributes", a.key)}
                    className={`text-xs px-2 py-1 rounded-md border ${
                      on
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                        : "bg-transparent border-[var(--border)]"
                    }`}
                  >
                    {a.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium mb-1">Nice-to-have mentor attributes</div>
            <div className="flex flex-wrap gap-2">
              {ATTRS.map((a) => {
                const on = form.nice_to_have_attributes.includes(a.key);
                return (
                  <button
                    key={a.key}
                    type="button"
                    onClick={() => toggleAttr("nice_to_have_attributes", a.key)}
                    className={`text-xs px-2 py-1 rounded-md border ${
                      on
                        ? "bg-[var(--secondary)] text-[var(--secondary-foreground)] border-[var(--secondary)]"
                        : "bg-transparent border-[var(--border)]"
                    }`}
                  >
                    {a.label}
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
              {saving ? "Saving…" : "Save preferences"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
