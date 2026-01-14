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

  const [accessData, setAccessData] = useState({
    userId: "",
    role: "",
    status: "",
  });
  const [accessError, setAccessError] = useState<string | null>(null);
  const [isUpdatingAccess, setIsUpdatingAccess] = useState(false);

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

      // Fetch member profile
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

      // Fetch system access role
      // We need to look up the user_id from the members table (if it exists) or try to find by email
      // Note: members table has user_id if they are linked
      const memberWithUser = m as Member & { user_id?: string };
      if (memberWithUser.user_id) {
         const { data: access } = await supabase
           .from("user_organization_roles")
           .select("role, status")
           .eq("organization_id", org.id)
           .eq("user_id", memberWithUser.user_id)
           .maybeSingle();
         
         if (access) {
           setAccessData({
             userId: memberWithUser.user_id,
             role: access.role,
             status: access.status,
           });
         }
      }

      setIsFetching(false);
    };

    fetchMember();
  }, [orgSlug, memberId]);

  const handleAccessUpdate = async () => {
    if (!accessData.userId) return;
    setIsUpdatingAccess(true);
    setAccessError(null);

    const supabase = createClient();
    const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .single();

    if (!org) return;

    const { error: updateError } = await supabase
      .from("user_organization_roles")
      .update({
        role: accessData.role as "admin" | "active_member" | "alumni",
        status: accessData.status as "active" | "revoked" | "pending",
      })
      .eq("organization_id", org.id)
      .eq("user_id", accessData.userId);

    if (updateError) {
      setAccessError(updateError.message);
    } else {
      // Show success briefly or just refresh
      router.refresh();
    }
    setIsUpdatingAccess(false);
  };

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

      <div className="grid gap-6">
        <Card className="max-w-2xl">
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            <div>
              <h3 className="font-semibold text-foreground mb-4">Profile Information</h3>
              {error && (
                <div className="p-3 mb-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
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
                className="mb-4"
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <Input
                  label="Title/Position"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  placeholder="e.g., Quarterback, Member, Staff"
                />
                <Input
                  label="Graduation Year"
                  type="number"
                  value={formData.graduation_year}
                  onChange={(e) => setFormData({ ...formData, graduation_year: e.target.value })}
                  placeholder="2025"
                  min={1900}
                  max={2100}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
               <Input
                 label="Photo URL"
                 type="url"
                 value={formData.photo_url}
                 onChange={(e) => setFormData({ ...formData, photo_url: e.target.value })}
                 placeholder="https://example.com/photo.jpg"
               />
               <Input
                 label="LinkedIn profile (optional)"
                 type="url"
                 value={formData.linkedin_url}
                 onChange={(e) => setFormData({ ...formData, linkedin_url: e.target.value })}
                 placeholder="https://www.linkedin.com/in/username"
               />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-border">
              <Button type="button" variant="secondary" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" isLoading={isLoading}>
                Save Profile
              </Button>
            </div>
          </form>
        </Card>

        {/* System Access Section - Only visible if user record exists */}
        {accessData.userId && (
          <Card className="max-w-2xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-foreground">System Access</h3>
                  <p className="text-sm text-muted-foreground">Manage roles and permissions</p>
                </div>
                {accessData.status === "revoked" && (
                  <span className="px-3 py-1 bg-red-100 text-red-700 rounded-lg text-sm font-medium">
                    Access Revoked
                  </span>
                )}
              </div>

              {accessError && (
                 <div className="p-3 mb-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                   {accessError}
                 </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <Select
                  label="System Role"
                  value={accessData.role}
                  onChange={(e) => setAccessData({ ...accessData, role: e.target.value })}
                  options={[
                    { value: "active_member", label: "Active Member" },
                    { value: "admin", label: "Admin" },
                    { value: "alumni", label: "Alumni" },
                  ]}
                />
                
                <Select
                  label="Access Status"
                  value={accessData.status}
                  onChange={(e) => setAccessData({ ...accessData, status: e.target.value })}
                  options={[
                    { value: "active", label: "Active" },
                    { value: "pending", label: "Pending (Needs Approval)" },
                    { value: "revoked", label: "Revoked (Disabled)" },
                  ]}
                />
              </div>

              <div className="flex justify-end pt-4 border-t border-border">
                <Button 
                  onClick={handleAccessUpdate} 
                  isLoading={isUpdatingAccess}
                  variant="secondary"
                >
                  Update Access
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}







