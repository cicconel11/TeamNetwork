"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { animate, stagger } from "animejs";
import { createClient } from "@/lib/supabase/client";
import type { NotificationPreference, UserRole } from "@/types/database";
import { normalizeRole, type OrgRole } from "@/lib/auth/role-utils";
import { Card, Button } from "@/components/ui";
import { PermissionRoleCard } from "@/components/ui/PermissionRoleCard";
import { PageHeader } from "@/components/layout";
import { OrgNameCard } from "@/components/settings/OrgNameCard";
import { BrandingCard } from "@/components/settings/BrandingCard";
import { NotificationPrefsCard } from "@/components/settings/NotificationPrefsCard";
import { StorageUsageCard } from "@/components/settings/StorageUsageCard";

export default function OrgSettingsPage() {
  return (
    <Suspense fallback={<OrgSettingsLoading />}>
      <OrgSettingsContent />
    </Suspense>
  );
}

function OrgSettingsLoading() {
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customization"
        description="Update your org brand and notifications in one place."
        backHref={`/${orgSlug}`}
      />
      <Card className="p-5 text-muted-foreground text-sm">Loading settings...</Card>
    </div>
  );
}

function OrgSettingsContent() {
  const params = useParams();
  const router = useRouter();
  const orgSlug = params.orgSlug as string;
  const supabase = useMemo(() => createClient(), []);

  // Bootstrap state
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [role, setRole] = useState<OrgRole | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // Initial data for child components
  const [initialLogoUrl, setInitialLogoUrl] = useState<string | null>(null);
  const [initialPrimaryColor, setInitialPrimaryColor] = useState("#1e3a5f");
  const [initialSecondaryColor, setInitialSecondaryColor] = useState("#10b981");
  const [initialPrefs, setInitialPrefs] = useState<{
    prefId: string | null;
    email: string;
    emailEnabled: boolean;
    announcementEnabled: boolean;
    discussionEnabled: boolean;
    eventEnabled: boolean;
    workoutEnabled: boolean;
    competitionEnabled: boolean;
  } | null>(null);

  // Permission role card state
  const [feedPostRoles, setFeedPostRoles] = useState<string[]>(["admin", "active_member", "alumni"]);
  const [feedSaving, setFeedSaving] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedSuccess, setFeedSuccess] = useState<string | null>(null);
  const [jobPostRoles, setJobPostRoles] = useState<string[]>(["admin", "alumni"]);
  const [jobSaving, setJobSaving] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const [jobSuccess, setJobSuccess] = useState<string | null>(null);
  const [discussionPostRoles, setDiscussionPostRoles] = useState<string[]>(["admin", "active_member", "alumni"]);
  const [discussionSaving, setDiscussionSaving] = useState(false);
  const [discussionError, setDiscussionError] = useState<string | null>(null);
  const [discussionSuccess, setDiscussionSuccess] = useState<string | null>(null);
  const [mediaUploadRoles, setMediaUploadRoles] = useState<string[]>(["admin"]);
  const [mediaSaving, setMediaSaving] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaSuccess, setMediaSuccess] = useState<string | null>(null);

  // Bootstrap fetch
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setPageError(null);

      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .select("id, name, logo_url, primary_color, secondary_color, feed_post_roles, job_post_roles, discussion_post_roles, media_upload_roles")
        .eq("slug", orgSlug)
        .maybeSingle();

      if (!org || orgError) {
        setPageError(orgError?.message || "Organization not found");
        setLoading(false);
        return;
      }

      setOrgId(org.id);
      setOrgName(org.name || "Organization");
      setInitialLogoUrl(org.logo_url);
      setInitialPrimaryColor(org.primary_color || "#1e3a5f");
      setInitialSecondaryColor(org.secondary_color || "#10b981");
      setFeedPostRoles((org as Record<string, unknown>).feed_post_roles as string[] || ["admin", "active_member", "alumni"]);
      setJobPostRoles((org as Record<string, unknown>).job_post_roles as string[] || ["admin", "alumni"]);
      setDiscussionPostRoles((org as Record<string, unknown>).discussion_post_roles as string[] || ["admin", "active_member", "alumni"]);
      setMediaUploadRoles((org as Record<string, unknown>).media_upload_roles as string[] || ["admin"]);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setPageError("You must be signed in.");
        setLoading(false);
        router.push(`/auth/login?redirect=/${orgSlug}/customization`);
        return;
      }

      setUserId(user.id);

      const { data: membership } = await supabase
        .from("user_organization_roles")
        .select("status, role")
        .eq("organization_id", org.id)
        .eq("user_id", user.id)
        .maybeSingle();

      const normalizedRole = normalizeRole((membership?.role as UserRole | null) ?? null);

      if (!membership || membership.status !== "active" || !normalizedRole) {
        setPageError("You do not have access to this organization.");
        setLoading(false);
        return;
      }

      setRole(normalizedRole);

      const { data: pref } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("organization_id", org.id)
        .eq("user_id", user.id)
        .maybeSingle();

      const typedPref = pref as NotificationPreference | null;
      setInitialPrefs({
        prefId: typedPref?.id || null,
        email: typedPref?.email_address || user.email || "",
        emailEnabled: typedPref?.email_enabled ?? true,
        announcementEnabled: typedPref?.announcement_emails_enabled ?? true,
        discussionEnabled: typedPref?.discussion_emails_enabled ?? true,
        eventEnabled: typedPref?.event_emails_enabled ?? true,
        workoutEnabled: typedPref?.workout_emails_enabled ?? true,
        competitionEnabled: typedPref?.competition_emails_enabled ?? true,
      });

      setLoading(false);
    };

    load();
  }, [orgSlug, router, supabase]);

  // Entrance animation
  useEffect(() => {
    if (loading) return;
    const animation = animate(".org-settings-card", {
      opacity: [0, 1],
      translateY: [12, 0],
      delay: stagger(70),
      duration: 550,
      easing: "easeOutQuad",
    });

    return () => {
      animation.pause();
    };
  }, [loading]);

  // Permission role save helpers
  const makeRoleSaveHandler = (
    field: string,
    roles: string[],
    setSaving: (v: boolean) => void,
    setErr: (v: string | null) => void,
    setSucc: (v: string | null) => void,
    setRoles: (v: string[]) => void,
    label: string,
  ) => {
    return async () => {
      if (!orgId) return;
      if (role !== "admin") {
        setErr(`Only admins can change ${label} permissions.`);
        return;
      }

      setSaving(true);
      setErr(null);
      setSucc(null);

      try {
        const res = await fetch(`/api/organizations/${orgId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: roles }),
        });
        const data = await res.json().catch(() => null);

        if (!res.ok) {
          throw new Error(data?.error || `Unable to update ${label} permissions`);
        }

        if (data?.[field]) {
          setRoles(data[field]);
        }
        setSucc(`${label} permissions updated.`);
      } catch (err) {
        setErr(err instanceof Error ? err.message : `Unable to update ${label} permissions`);
      } finally {
        setSaving(false);
      }
    };
  };

  const makeToggleHandler = (
    setRoles: React.Dispatch<React.SetStateAction<string[]>>,
    setSucc: (v: string | null) => void,
  ) => {
    return (toggleRole: string) => {
      if (toggleRole === "admin") return;
      setRoles((prev) =>
        prev.includes(toggleRole) ? prev.filter((r) => r !== toggleRole) : [...prev, toggleRole],
      );
      setSucc(null);
    };
  };

  const handleFeedRolesSave = makeRoleSaveHandler("feed_post_roles", feedPostRoles, setFeedSaving, setFeedError, setFeedSuccess, setFeedPostRoles, "Feed posting");
  const toggleFeedRole = makeToggleHandler(setFeedPostRoles, setFeedSuccess);

  const handleDiscussionRolesSave = makeRoleSaveHandler("discussion_post_roles", discussionPostRoles, setDiscussionSaving, setDiscussionError, setDiscussionSuccess, setDiscussionPostRoles, "Discussion posting");
  const toggleDiscussionRole = makeToggleHandler(setDiscussionPostRoles, setDiscussionSuccess);

  const handleJobRolesSave = makeRoleSaveHandler("job_post_roles", jobPostRoles, setJobSaving, setJobError, setJobSuccess, setJobPostRoles, "Job posting");
  const toggleJobRole = makeToggleHandler(setJobPostRoles, setJobSuccess);

  const handleMediaRolesSave = makeRoleSaveHandler("media_upload_roles", mediaUploadRoles, setMediaSaving, setMediaError, setMediaSuccess, setMediaUploadRoles, "Media upload");
  const toggleMediaRole = makeToggleHandler(setMediaUploadRoles, setMediaSuccess);

  const isAdmin = role === "admin";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customization"
        description="Update your org brand and notifications in one place."
        backHref={`/${orgSlug}`}
      />

      {loading ? (
        <Card className="p-5 text-muted-foreground text-sm">Loading settings...</Card>
      ) : pageError ? (
        <Card className="p-5 text-red-600 dark:text-red-400 text-sm">{pageError}</Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <OrgNameCard
            orgId={orgId!}
            orgName={orgName}
            isAdmin={isAdmin}
            onNameUpdated={setOrgName}
          />

          <BrandingCard
            orgId={orgId!}
            orgSlug={orgSlug}
            orgName={orgName}
            isAdmin={isAdmin}
            initialLogoUrl={initialLogoUrl}
            initialPrimaryColor={initialPrimaryColor}
            initialSecondaryColor={initialSecondaryColor}
          />

          {initialPrefs && userId && (
            <NotificationPrefsCard
              orgId={orgId!}
              orgName={orgName}
              userId={userId}
              initialPrefs={initialPrefs}
            />
          )}

          {/* Google Calendar Sync — redirect to My Calendar tab */}
          <Card className="org-settings-card p-5 space-y-3 opacity-0 translate-y-2">
            <div className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-foreground"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm-8 4H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z" />
              </svg>
              <p className="font-semibold text-foreground">Google Calendar Sync</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Manage your Google Calendar connection and sync preferences in the Calendar section.
            </p>
            <Link href={`/${orgSlug}/calendar/my-settings`}>
              <Button variant="secondary" size="sm">Go to Sync Settings</Button>
            </Link>
          </Card>

          {/* Posting & Upload Permission Cards (admin-only) */}
          {isAdmin && (
            <PermissionRoleCard
              title="Feed posting permissions"
              description="Control which roles can create posts in the Feed."
              featureVerb="create feed posts"
              roles={feedPostRoles}
              onToggleRole={toggleFeedRole}
              onSave={handleFeedRolesSave}
              saving={feedSaving}
              error={feedError}
              success={feedSuccess}
            />
          )}

          {isAdmin && (
            <PermissionRoleCard
              title="Discussion posting permissions"
              description="Control which roles can create threads in Discussions."
              featureVerb="create discussion threads"
              roles={discussionPostRoles}
              onToggleRole={toggleDiscussionRole}
              onSave={handleDiscussionRolesSave}
              saving={discussionSaving}
              error={discussionError}
              success={discussionSuccess}
            />
          )}

          {isAdmin && (
            <PermissionRoleCard
              title="Job posting permissions"
              description="Control which roles can post jobs in the Jobs board."
              featureVerb="post jobs"
              roles={jobPostRoles}
              onToggleRole={toggleJobRole}
              onSave={handleJobRolesSave}
              saving={jobSaving}
              error={jobError}
              success={jobSuccess}
            />
          )}

          {isAdmin && (
            <PermissionRoleCard
              title="Media upload permissions"
              description="Control which roles can upload media to the Media Archive."
              featureVerb="upload media"
              roles={mediaUploadRoles}
              onToggleRole={toggleMediaRole}
              onSave={handleMediaRolesSave}
              saving={mediaSaving}
              error={mediaError}
              success={mediaSuccess}
            />
          )}

          {/* Storage Usage Card (admin-only) */}
          {isAdmin && <StorageUsageCard orgId={orgId!} />}
        </div>
      )}
    </div>
  );
}
