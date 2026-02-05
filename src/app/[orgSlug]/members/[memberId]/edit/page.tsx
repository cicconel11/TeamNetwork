"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Select } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { editMemberSchema, type EditMemberForm } from "@/lib/schemas/member";
import type { Member } from "@/types/database";

export default function EditMemberPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const memberId = params.memberId as string;

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<EditMemberForm>({
    resolver: zodResolver(editMemberSchema),
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      role: "",
      status: "active",
      graduation_year: "",
      expected_graduation_date: "",
      photo_url: "",
      linkedin_url: "",
    },
  });

  const [accessData, setAccessData] = useState({
    userId: "",
    role: "",
    status: "",
  });
  const [accessError, setAccessError] = useState<string | null>(null);
  const [isUpdatingAccess, setIsUpdatingAccess] = useState(false);

  const [isReinstating, setIsReinstating] = useState(false);
  const [reinstateError, setReinstateError] = useState<string | null>(null);

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

      const m = member as Member & {
        expected_graduation_date?: string;
        graduated_at?: string;
      };
      reset({
        first_name: m.first_name || "",
        last_name: m.last_name || "",
        email: m.email || "",
        role: m.role || "",
        status: m.status || "active",
        graduation_year: m.graduation_year?.toString() || "",
        expected_graduation_date: m.expected_graduation_date || "",
        photo_url: m.photo_url || "",
        linkedin_url: m.linkedin_url || "",
      });

      // Fetch system access role
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
  }, [orgSlug, memberId, reset]);

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
      router.refresh();
    }
    setIsUpdatingAccess(false);
  };

  const handleReinstate = async () => {
    setIsReinstating(true);
    setReinstateError(null);

    const supabase = createClient();
    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("slug", orgSlug)
      .single();

    if (!org) {
      setReinstateError("Organization not found");
      setIsReinstating(false);
      return;
    }

    const response = await fetch(
      `/api/organizations/${org.id}/members/${memberId}/reinstate`,
      { method: "POST" }
    );

    const data = await response.json();

    if (!response.ok) {
      setReinstateError(data.error || "Failed to reinstate member");
    } else {
      router.refresh();
      setAccessData({ ...accessData, role: "active_member", status: "pending" });
    }
    setIsReinstating(false);
  };

  const onSubmit = async (data: EditMemberForm) => {
    setIsLoading(true);
    setError(null);

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
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email || null,
        role: data.role || null,
        status: data.status,
        graduation_year: data.graduation_year ? parseInt(data.graduation_year) : null,
        expected_graduation_date: data.expected_graduation_date || null,
        photo_url: data.photo_url || null,
        linkedin_url: data.linkedin_url || null,
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
          <form data-testid="member-edit-form" onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
            <div>
              <h3 className="font-semibold text-foreground mb-4">Profile Information</h3>
              {error && (
                <div data-testid="member-edit-error" className="p-3 mb-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <Input
                  label="First Name"
                  data-testid="member-edit-first-name"
                  error={errors.first_name?.message}
                  {...register("first_name")}
                />
                <Input
                  label="Last Name"
                  data-testid="member-edit-last-name"
                  error={errors.last_name?.message}
                  {...register("last_name")}
                />
              </div>

              <Input
                label="Email"
                type="email"
                placeholder="member@example.com"
                className="mb-4"
                data-testid="member-edit-email"
                error={errors.email?.message}
                {...register("email")}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <Input
                  label="Title/Position"
                  placeholder="e.g., Quarterback, Member, Staff"
                  error={errors.role?.message}
                  {...register("role")}
                />
                <Input
                  label="Graduation Year"
                  type="number"
                  placeholder="2025"
                  min={1900}
                  max={2100}
                  error={errors.graduation_year?.message}
                  {...register("graduation_year")}
                />
              </div>

              <div className="mb-4">
                <Input
                  label="Expected Graduation Date"
                  type="date"
                  error={errors.expected_graduation_date?.message}
                  {...register("expected_graduation_date", {
                    onChange: (e) => {
                      if (e.target.value) {
                        // Parse year directly from YYYY-MM-DD string to avoid timezone issues
                        // Using new Date("YYYY-MM-DD").getFullYear() can return wrong year
                        // in timezones west of UTC (e.g., 2025-01-01 becomes 2024)
                        const year = parseInt(e.target.value.split("-")[0], 10);
                        setValue("graduation_year", year.toString());
                      }
                    },
                  })}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  When this member will automatically transition to alumni status
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <Input
                  label="Photo URL"
                  type="url"
                  placeholder="https://example.com/photo.jpg"
                  error={errors.photo_url?.message}
                  {...register("photo_url")}
                />
                <Input
                  label="LinkedIn profile (optional)"
                  type="url"
                  placeholder="https://www.linkedin.com/in/username"
                  error={errors.linkedin_url?.message}
                  {...register("linkedin_url")}
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-border">
              <Button type="button" variant="secondary" onClick={() => router.back()} data-testid="member-edit-cancel">
                Cancel
              </Button>
              <Button type="submit" isLoading={isLoading} data-testid="member-edit-submit">
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

              {/* Reinstate Button - show for alumni members */}
              {accessData.role === "alumni" && (
                <div className="mb-4 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-amber-800 dark:text-amber-200">
                        This member is an alumni
                      </p>
                      <p className="text-sm text-amber-600 dark:text-amber-400">
                        Reinstate them as an active member pending approval
                      </p>
                    </div>
                    <Button
                      onClick={handleReinstate}
                      isLoading={isReinstating}
                      variant="secondary"
                      className="whitespace-nowrap"
                    >
                      Reinstate Member
                    </Button>
                  </div>
                  {reinstateError && (
                    <p className="mt-2 text-sm text-red-600">{reinstateError}</p>
                  )}
                </div>
              )}

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
