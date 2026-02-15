"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, Input, Textarea, Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { createMentorProfileSchema } from "@/lib/schemas/mentorship";

interface MentorRegistrationProps {
  orgId: string;
  orgSlug: string;
  onCancel: () => void;
}

export function MentorRegistration({ orgId, onCancel }: MentorRegistrationProps) {
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

      // Insert mentor profile
      const { error: insertError } = await supabase
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
    <Card>
      <CardHeader>
        <CardTitle>Become a Mentor</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Fill out your profile to let current members know you&apos;re available to help
        </p>
      </CardHeader>

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

        <div className="border-t border-border pt-4">
          <h4 className="text-sm font-medium mb-3">Contact Information</h4>
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

        {error && (
          <div className="p-3 bg-error/10 border border-error/20 rounded-md">
            <p className="text-sm text-error">{error}</p>
          </div>
        )}

        <div className="flex gap-2 pt-2">
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
    </Card>
  );
}
