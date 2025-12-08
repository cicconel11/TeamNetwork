"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { checkIsOrgAdmin } from "@/lib/auth-client";
import { Card, Button, Input, Select, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";

export default function NewEventPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    start_date: "",
    start_time: "",
    end_date: "",
    end_time: "",
    location: "",
    event_type: "general",
    is_philanthropy: false,
  });

  // Check admin status on mount
  useEffect(() => {
    const checkAdmin = async () => {
      const isAdmin = await checkIsOrgAdmin(orgSlug);
      if (!isAdmin) {
        router.push(`/${orgSlug}/events`);
        return;
      }
      setIsChecking(false);
    };
    checkAdmin();
  }, [orgSlug, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const supabase = createClient();

    // Get organization ID
    const { data: orgs, error: orgError } = await supabase
      .from("organizations")
      .select("id")
      .eq("slug", orgSlug)
      .limit(1);

    const org = orgs?.[0];

    if (!org || orgError) {
      setError("Organization not found");
      setIsLoading(false);
      return;
    }

    // Combine date and time
    const startDateTime = new Date(`${formData.start_date}T${formData.start_time}`).toISOString();
    const endDateTime = formData.end_date && formData.end_time
      ? new Date(`${formData.end_date}T${formData.end_time}`).toISOString()
      : null;

    const { error: insertError } = await supabase.from("events").insert({
      organization_id: org.id,
      title: formData.title,
      description: formData.description || null,
      start_date: startDateTime,
      end_date: endDateTime,
      location: formData.location || null,
      event_type: formData.event_type as "general" | "philanthropy" | "game" | "meeting" | "social" | "fundraiser",
      is_philanthropy: formData.is_philanthropy || formData.event_type === "philanthropy",
    });

    if (insertError) {
      setError(insertError.message);
      setIsLoading(false);
      return;
    }

    router.push(`/${orgSlug}/events`);
    router.refresh();
  };

  if (isChecking) {
    return (
      <div className="animate-pulse">
        <div className="h-8 w-48 bg-muted rounded-xl mb-4" />
        <div className="h-4 w-64 bg-muted rounded-xl" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Create New Event"
        description="Add an event to your organization's calendar"
        backHref={`/${orgSlug}/events`}
      />

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <Input
            label="Event Title"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="e.g., Team Meeting, vs Cornell"
            required
          />

          <Textarea
            label="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Add event details..."
            rows={3}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Start Date"
              type="date"
              value={formData.start_date}
              onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
              required
            />
            <Input
              label="Start Time"
              type="time"
              value={formData.start_time}
              onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="End Date (Optional)"
              type="date"
              value={formData.end_date}
              onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
            />
            <Input
              label="End Time (Optional)"
              type="time"
              value={formData.end_time}
              onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
            />
          </div>

          <Input
            label="Location"
            value={formData.location}
            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
            placeholder="e.g., Franklin Field, Team Room"
          />

          <Select
            label="Event Type"
            value={formData.event_type}
            onChange={(e) => setFormData({ ...formData, event_type: e.target.value })}
            options={[
              { value: "general", label: "General" },
              { value: "game", label: "Game" },
              { value: "meeting", label: "Meeting" },
              { value: "social", label: "Social" },
              { value: "fundraiser", label: "Fundraiser" },
              { value: "philanthropy", label: "Philanthropy" },
            ]}
          />

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="is_philanthropy"
              checked={formData.is_philanthropy}
              onChange={(e) => setFormData({ ...formData, is_philanthropy: e.target.checked })}
              className="h-4 w-4 rounded border-border text-org-primary focus:ring-org-primary"
            />
            <label htmlFor="is_philanthropy" className="text-sm text-foreground">
              Mark as philanthropy event (will show in Philanthropy section)
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading}>
              Create Event
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
