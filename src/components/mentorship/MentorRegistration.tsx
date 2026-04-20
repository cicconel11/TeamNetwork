"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Textarea, Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { createMentorProfileSchema } from "@/lib/schemas/mentorship";
import type { CustomAttributeDef } from "@/lib/mentorship/matching-weights";

interface MentorRegistrationProps {
  orgId: string;
  orgSlug: string;
  onCancel: () => void;
  customAttributeDefs?: readonly CustomAttributeDef[];
}

export function MentorRegistration({ orgId, onCancel, customAttributeDefs = [] }: MentorRegistrationProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
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

      // Insert mentor profile — custom_attributes not in generated types yet
      const { error: insertError } = await (supabase as unknown as {
        from: (t: string) => {
          insert: (data: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
        };
      })
        .from("mentor_profiles")
        .insert({
          organization_id: orgId,
          user_id: user.id,
          bio: formData.bio || null,
          expertise_areas: expertiseArray.length > 0 ? expertiseArray : [],
          contact_email: formData.contact_email || null,
          contact_linkedin: formData.contact_linkedin || null,
          contact_phone: formData.contact_phone || null,
          is_active: true,
          custom_attributes: Object.keys(cleanCustomAttrs).length > 0 ? cleanCustomAttrs : {},
        });

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

  return (
    <div>
      <div className="pb-3 mb-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Become a Mentor</h3>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Fill out your profile to let current members know you&apos;re available to help
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Textarea
          label="Bio"
          placeholder="Tell members about your background and what you can help with..."
          value={formData.bio}
          onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
          rows={4}
        />

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
