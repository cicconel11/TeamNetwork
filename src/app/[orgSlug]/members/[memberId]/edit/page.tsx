"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Select } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import type { Member } from "@/types/database";

export default function EditMemberPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const memberId = params.memberId as string;

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    email: "",
    role: "",
    status: "active",
    graduation_year: "",
    photo_url: "",
    linkedin_url: "",
  });

  useEffect(() => {
    const fetchMember = async () => {
      const supabase = createClient();

      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .single();

      if (!org) {
        setError("Organization not found");
        setIsFetching(false);
        return;
      }

      const { data: member } = await supabase
        .from("members")
        .select("*")
        .eq("id", memberId)
        .eq("organization_id", org.id)
        .is("deleted_at", null)
        .single();

      if (!member) {
        setError("Member not found");
        setIsFetching(false);
        return;
      }

      const m = member as Member;
      setFormData({
        first_name: m.first_name || "",
        last_name: m.last_name || "",
        email: m.email || "",
        role: m.role || "",
        status: m.status || "active",
        graduation_year: m.graduation_year?.toString() || "",
        photo_url: m.photo_url || "",
        linkedin_url: m.linkedin_url || "",
      });
      setIsFetching(false);
    };

    fetchMember();
  }, [orgSlug, memberId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const linkedin = formData.linkedin_url?.trim();
    if (linkedin) {
      try {
        const url = new URL(linkedin);
        if (url.protocol !== "https:") {
          throw new Error("LinkedIn URL must start with https://");
        }
      } catch {
        setError("Please enter a valid LinkedIn profile URL (https://...)");
        setIsLoading(false);
        return;
      }
    }

    const supabase = createClient();

    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("slug", orgSlug)
      .single();

    if (!org) {
      setError("Organization not found");
      setIsLoading(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("members")
      .update({
        first_name: formData.first_name,
        last_name: formData.last_name,
        email: formData.email || null,
        role: formData.role || null,
        status: formData.status as "active" | "inactive",
        graduation_year: formData.graduation_year ? parseInt(formData.graduation_year) : null,
        photo_url: formData.photo_url || null,
        linkedin_url: linkedin || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", memberId)
      .eq("organization_id", org.id);

    if (updateError) {
      setError(updateError.message);
      setIsLoading(false);
      return;
    }

    router.push(`/${orgSlug}/members/${memberId}`);
    router.refresh();
  };

  if (isFetching) {
    return (
      <div className="animate-fade-in">
        <PageHeader
          title="Edit Member"
          description="Loading..."
          backHref={`/${orgSlug}/members/${memberId}`}
        />
        <Card className="max-w-2xl p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-10 bg-muted rounded-xl" />
            <div className="h-10 bg-muted rounded-xl" />
            <div className="h-10 bg-muted rounded-xl" />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Edit Member"
        description="Update member information"
        backHref={`/${orgSlug}/members/${memberId}`}
      />

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="First Name"
              value={formData.first_name}
              onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
              required
            />
            <Input
              label="Last Name"
              value={formData.last_name}
              onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
              required
            />
          </div>

          <Input
            label="Email"
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            placeholder="member@example.com"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Role/Position"
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              placeholder="e.g., Quarterback, Member, Staff"
            />
            <Select
              label="Status"
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              options={[
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
              ]}
            />
          </div>

          <Input
            label="Graduation Year"
            type="number"
            value={formData.graduation_year}
            onChange={(e) => setFormData({ ...formData, graduation_year: e.target.value })}
            placeholder="2025"
            min={1900}
            max={2100}
          />

          <Input
            label="Photo URL"
            type="url"
            value={formData.photo_url}
            onChange={(e) => setFormData({ ...formData, photo_url: e.target.value })}
            placeholder="https://example.com/photo.jpg"
            helperText="Direct link to member photo"
          />

          <Input
            label="LinkedIn profile (optional)"
            type="url"
            value={formData.linkedin_url}
            onChange={(e) => setFormData({ ...formData, linkedin_url: e.target.value })}
            placeholder="https://www.linkedin.com/in/username"
            helperText="Must be a valid https:// URL"
          />

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading}>
              Save Changes
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}




