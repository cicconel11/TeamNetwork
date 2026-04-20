"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Textarea, Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { createMentorProfileSchema } from "@/lib/schemas/mentorship";
import type { CustomAttributeDef } from "@/lib/mentorship/matching-weights";
import type { Database } from "@/types/database";

interface MentorRegistrationProps {
  orgId: string;
  orgSlug: string;
  onCancel: () => void;
  customAttributeDefs?: readonly CustomAttributeDef[];
}

export function MentorRegistration({ orgId, onCancel, customAttributeDefs = [] }: MentorRegistrationProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(true);
  const [aiDrafted, setAiDrafted] = useState(false);
  const [bioEdited, setBioEdited] = useState(false);
  const [inputHash, setInputHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    bio: "",
    expertise_areas: "",
    contact_email: "",
    contact_linkedin: "",
    contact_phone: "",
  });
  const [customAttrs, setCustomAttrs] = useState<Record<string, string | string[]>>({});

  const visibleDefs = customAttributeDefs.filter((d) => d.mentorVisible !== false);

  // Fetch AI-generated bio on mount
  useEffect(() => {
    async function generateBio() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setIsGenerating(false);
          return;
        }

        const res = await fetch(
          `/api/organizations/${orgId}/mentorship/generate-bio`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: user.id }),
          }
        );

        if (!res.ok) {
          setIsGenerating(false);
          return;
        }

        const data = await res.json();

        if (data.bio) {
          setFormData((prev) => ({
            ...prev,
            bio: data.bio,
            expertise_areas: data.expertiseAreas?.join(", ") ?? prev.expertise_areas,
          }));
          setAiDrafted(true);
        }
        if (data.inputHash) {
          setInputHash(data.inputHash);
        }
      } catch {
        // Silently fall back to empty form
      } finally {
        setIsGenerating(false);
      }
    }

    generateBio();
  }, [orgId]);

  const handleBioChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setFormData({ ...formData, bio: e.target.value });
    if (aiDrafted) setBioEdited(true);
  };

  const handleRegenerate = async () => {
    setIsGenerating(true);
    setAiDrafted(false);
    setBioEdited(false);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const res = await fetch(
        `/api/organizations/${orgId}/mentorship/generate-bio`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: user.id }),
        }
      );

      if (res.ok) {
        const data = await res.json();
        if (data.bio) {
          setFormData((prev) => ({
            ...prev,
            bio: data.bio,
            expertise_areas: data.expertiseAreas?.join(", ") ?? prev.expertise_areas,
          }));
          setAiDrafted(true);
          if (data.inputHash) setInputHash(data.inputHash);
        }
      }
    } catch {
      // Silent failure
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      // Validate form data
      const validationResult = createMentorProfileSchema.safeParse(formData);
      if (!validationResult.success) {
        const firstError = validationResult.error.issues[0];
        setError(`${firstError.path.join(".")}: ${firstError.message}`);
        setIsSubmitting(false);
        return;
      }

      const supabase = createClient();

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error("You must be logged in to register as a mentor");
      }

      // Parse expertise areas (comma-separated)
      const expertiseArray = formData.expertise_areas
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      // Build custom_attributes jsonb from dynamic form fields
      const cleanCustomAttrs: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(customAttrs)) {
        if (typeof value === "string" && value.trim()) {
          cleanCustomAttrs[key] = value.trim();
        } else if (Array.isArray(value) && value.length > 0) {
          cleanCustomAttrs[key] = value;
        }
      }

      // Determine bio_source
      const bioSource = aiDrafted && !bioEdited ? "ai_generated" : "manual";

      const insertPayload: Database["public"]["Tables"]["mentor_profiles"]["Insert"] = {
        organization_id: orgId,
        user_id: user.id,
        bio: formData.bio || null,
        expertise_areas: expertiseArray.length > 0 ? expertiseArray : [],
        contact_email: formData.contact_email || null,
        contact_linkedin: formData.contact_linkedin || null,
        contact_phone: formData.contact_phone || null,
        is_active: true,
        custom_attributes: Object.keys(cleanCustomAttrs).length > 0 ? cleanCustomAttrs : {},
        bio_source: bioSource,
        bio_generated_at: bioSource === "ai_generated" ? new Date().toISOString() : null,
        bio_input_hash: inputHash,
      };

      const { error: insertError } = await supabase
        .from("mentor_profiles")
        .insert(insertPayload);

      if (insertError) {
        throw insertError;
      }

      // Refresh the page to show the new mentor in the directory
      router.refresh();

      // Close the form
      onCancel();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to register as mentor";
      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isGenerating) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="pb-3 mb-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Become a Mentor</h3>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Drafting your profile with AI...
          </p>
        </div>
        <div className="h-24 bg-muted rounded-md" />
        <div className="h-10 bg-muted rounded-md" />
        <div className="h-10 bg-muted rounded-md w-2/3" />
      </div>
    );
  }

  return (
    <div>
      <div className="pb-3 mb-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Become a Mentor</h3>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          {aiDrafted
            ? "We pre-filled your profile from your data. Review and edit before saving."
            : "Fill out your profile to let current members know you're available to help"}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className="block text-sm font-medium text-foreground">Bio</label>
            {aiDrafted && !bioEdited && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1l1.8 3.6L14 5.4l-3 2.9.7 4.1L8 10.5l-3.7 1.9.7-4.1-3-2.9 4.2-.8z" />
                </svg>
                Drafted with AI
              </span>
            )}
            {aiDrafted && (
              <button
                type="button"
                onClick={handleRegenerate}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Regenerate
              </button>
            )}
          </div>
          <Textarea
            placeholder="Tell members about your background and what you can help with..."
            value={formData.bio}
            onChange={handleBioChange}
            rows={4}
          />
        </div>

        <Input
          label="Areas of Expertise"
          placeholder="e.g., Career advice, Interview prep, Industry insights"
          helperText="Separate multiple areas with commas"
          value={formData.expertise_areas}
          onChange={(e) => setFormData({ ...formData, expertise_areas: e.target.value })}
        />

        <div className="pt-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">Contact Information</h4>
          <div className="space-y-4">
            <Input
              label="Email"
              type="email"
              placeholder="your.email@example.com"
              value={formData.contact_email}
              onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
            />

            <Input
              label="LinkedIn URL"
              type="url"
              placeholder="https://linkedin.com/in/yourprofile"
              value={formData.contact_linkedin}
              onChange={(e) => setFormData({ ...formData, contact_linkedin: e.target.value })}
            />

            <Input
              label="Phone (optional)"
              type="tel"
              placeholder="+1 (555) 123-4567"
              value={formData.contact_phone}
              onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
            />
          </div>
        </div>

        {visibleDefs.length > 0 && (
          <div className="pt-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">Additional Information</h4>
            <div className="space-y-4">
              {visibleDefs
                .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
                .map((def) => {
                  if (def.type === "select" && def.options) {
                    return (
                      <div key={def.key}>
                        <label className="block text-sm font-medium text-foreground mb-1">
                          {def.label}{def.required && <span className="text-red-500 ml-0.5">*</span>}
                        </label>
                        <select
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                          value={(customAttrs[def.key] as string) || ""}
                          onChange={(e) => setCustomAttrs({ ...customAttrs, [def.key]: e.target.value })}
                          required={def.required}
                        >
                          <option value="">Select {def.label.toLowerCase()}...</option>
                          {def.options.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                    );
                  }
                  if (def.type === "multiselect" && def.options) {
                    const selected = Array.isArray(customAttrs[def.key]) ? customAttrs[def.key] as string[] : [];
                    return (
                      <div key={def.key}>
                        <label className="block text-sm font-medium text-foreground mb-1">
                          {def.label}{def.required && <span className="text-red-500 ml-0.5">*</span>}
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {def.options.map((opt) => {
                            const isChecked = selected.includes(opt.value);
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                                  isChecked
                                    ? "bg-[var(--color-org-primary)] text-white border-transparent"
                                    : "bg-background border-border text-foreground hover:bg-muted"
                                }`}
                                onClick={() => {
                                  const next = isChecked
                                    ? selected.filter((v) => v !== opt.value)
                                    : [...selected, opt.value];
                                  setCustomAttrs({ ...customAttrs, [def.key]: next });
                                }}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }
                  if (def.type === "text") {
                    return (
                      <Input
                        key={def.key}
                        label={def.label}
                        placeholder={`Enter ${def.label.toLowerCase()}...`}
                        value={(customAttrs[def.key] as string) || ""}
                        onChange={(e) => setCustomAttrs({ ...customAttrs, [def.key]: e.target.value })}
                        required={def.required}
                      />
                    );
                  }
                  return null;
                })}
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex gap-2 pt-3">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Registering..." : "Register as Mentor"}
          </Button>
        </div>
      </form>
    </div>
  );
}
