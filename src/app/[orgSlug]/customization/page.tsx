"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { animate, stagger } from "animejs";
import { createClient } from "@/lib/supabase/client";
import type { NotificationPreference, UserRole } from "@/types/database";
import { normalizeRole, type OrgRole } from "@/lib/auth/role-utils";
import { Card, Button, Badge, Input, ToggleSwitch } from "@/components/ui";
import { PermissionRoleCard } from "@/components/ui/PermissionRoleCard";
import { PageHeader } from "@/components/layout";
import { validateOrgName } from "@/lib/validation/org-name";
import { computeOrgThemeVariables } from "@/lib/theming/org-colors";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

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
      <Card className="p-5 text-muted-foreground text-sm">Loading settings…</Card>
    </div>
  );
}

function OrgSettingsContent() {
  const params = useParams();
  const router = useRouter();
  const orgSlug = params.orgSlug as string;
  const supabase = useMemo(() => createClient(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string>("");
  const [editedOrgName, setEditedOrgName] = useState<string>("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState("#1e3a5f");
  const [secondaryColor, setSecondaryColor] = useState("#10b981");
  const [role, setRole] = useState<OrgRole | null>(null);
  const [email, setEmail] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [announcementEnabled, setAnnouncementEnabled] = useState(true);
  const [discussionEnabled, setDiscussionEnabled] = useState(true);
  const [eventEnabled, setEventEnabled] = useState(true);
  const [workoutEnabled, setWorkoutEnabled] = useState(true);
  const [competitionEnabled, setCompetitionEnabled] = useState(true);
  const [prefId, setPrefId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [prefSaving, setPrefSaving] = useState(false);
  const [brandSaving, setBrandSaving] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [prefError, setPrefError] = useState<string | null>(null);
  const [prefSuccess, setPrefSuccess] = useState<string | null>(null);
  const [brandError, setBrandError] = useState<string | null>(null);
  const [brandSuccess, setBrandSuccess] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSuccess, setNameSuccess] = useState<string | null>(null);
  const [selectedLogo, setSelectedLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
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
  const [storageStats, setStorageStats] = useState<{
    total_bytes: number;
    quota_bytes: number | null;
    usage_percent: number;
    over_quota: boolean;
    media_items_count: number;
    media_uploads_count: number;
  } | null>(null);

  useEffect(() => {
    if (!selectedLogo) return;
    const previewUrl = URL.createObjectURL(selectedLogo);
    setLogoPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [selectedLogo]);

  useEffect(() => {
    return () => {
      const existingStyle = document.getElementById("org-theme-preview");
      if (existingStyle) existingStyle.remove();
    };
  }, []);

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
      setEditedOrgName(org.name || "Organization");
      setLogoUrl(org.logo_url);
      setPrimaryColor(org.primary_color || "#1e3a5f");
      setSecondaryColor(org.secondary_color || "#10b981");
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
      setEmail(typedPref?.email_address || user.email || "");
      setEmailEnabled(typedPref?.email_enabled ?? true);
      setAnnouncementEnabled(typedPref?.announcement_emails_enabled ?? true);
      setDiscussionEnabled(typedPref?.discussion_emails_enabled ?? true);
      setEventEnabled(typedPref?.event_emails_enabled ?? true);
      setWorkoutEnabled(typedPref?.workout_emails_enabled ?? true);
      setCompetitionEnabled(typedPref?.competition_emails_enabled ?? true);
      setPrefId(typedPref?.id || null);
      setLoading(false);
    };

    load();
  }, [orgSlug, router, supabase]);

  // Fetch storage stats for admins
  useEffect(() => {
    if (!orgId || role !== "admin") return;

    const fetchStats = async () => {
      const { data, error } = await supabase.rpc("get_media_storage_stats", {
        p_org_id: orgId,
      });
      if (!error && data && typeof data === "object" && "allowed" in (data as Record<string, unknown>) && (data as Record<string, unknown>).allowed) {
        const d = data as Record<string, unknown>;
        setStorageStats({
          total_bytes: (d.total_bytes as number) ?? 0,
          quota_bytes: (d.quota_bytes as number) ?? null,
          usage_percent: (d.usage_percent as number) ?? 0,
          over_quota: (d.over_quota as boolean) ?? false,
          media_items_count: (d.media_items_count as number) ?? 0,
          media_uploads_count: (d.media_uploads_count as number) ?? 0,
        });
      }
    };

    fetchStats();
  }, [orgId, role, supabase]);

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

  useEffect(() => {
    if (loading) return;
    animate(".org-brand-preview", {
      scale: [0.98, 1],
      opacity: [0.9, 1],
      duration: 480,
      easing: "easeOutQuad",
    });
  }, [primaryColor, secondaryColor, logoPreview, logoUrl, loading]);

  const applyThemeLocally = (nextPrimary: string, nextSecondary: string) => {
    const lightVars = computeOrgThemeVariables(nextPrimary, nextSecondary, false);
    const darkVars = computeOrgThemeVariables(nextPrimary, nextSecondary, true);

    const existingStyle = document.getElementById("org-theme-preview");
    if (existingStyle) existingStyle.remove();

    const style = document.createElement("style");
    style.id = "org-theme-preview";
    style.textContent = `
      :root {
        ${Object.entries(lightVars).map(([k, v]) => `${k}: ${v};`).join("\n        ")}
      }
      :root.dark {
        ${Object.entries(darkVars).map(([k, v]) => `${k}: ${v};`).join("\n        ")}
      }
      @media (prefers-color-scheme: dark) {
        :root:not(.light) {
          ${Object.entries(darkVars).map(([k, v]) => `${k}: ${v};`).join("\n          ")}
        }
      }
    `;
    document.head.appendChild(style);
  };

  const handlePreferenceSave = async () => {
    if (!orgId) return;
    setPrefSaving(true);
    setPrefError(null);
    setPrefSuccess(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setPrefError("You must be signed in.");
      setPrefSaving(false);
      return;
    }

    const { error: upsertError, data } = await supabase
      .from("notification_preferences")
      .upsert({
        id: prefId || undefined,
        organization_id: orgId,
        user_id: user.id,
        email_address: email.trim() || null,
        email_enabled: emailEnabled,
        announcement_emails_enabled: announcementEnabled,
        discussion_emails_enabled: discussionEnabled,
        event_emails_enabled: eventEnabled,
        workout_emails_enabled: workoutEnabled,
        competition_emails_enabled: competitionEnabled,
        phone_number: null,
        sms_enabled: false,
      })
      .select("id")
      .maybeSingle();

    if (upsertError) {
      setPrefError(upsertError.message);
      setPrefSaving(false);
      return;
    }

    setPrefId(data?.id || prefId);
    setPrefSaving(false);
    setPrefSuccess("Preferences saved for this organization.");
  };

  const handleBrandingSave = async () => {
    if (!orgId) return;
    if (role !== "admin") {
      setBrandError("Only admins can update branding.");
      return;
    }

    const colorPattern = /^#[0-9a-fA-F]{6}$/;
    if (!colorPattern.test(primaryColor) || !colorPattern.test(secondaryColor)) {
      setBrandError("Use 6-digit hex colors like #1e3a5f.");
      return;
    }

    setBrandSaving(true);
    setBrandError(null);
    setBrandSuccess(null);

    const formData = new FormData();
    formData.append("primaryColor", primaryColor);
    formData.append("secondaryColor", secondaryColor);
    if (selectedLogo) {
      formData.append("logo", selectedLogo);
    }

    try {
      const res = await fetch(`/api/organizations/${orgId}/branding`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || "Unable to save branding");
      }

      const updatedOrg = (data?.organization || null) as {
        logo_url?: string | null;
        primary_color?: string | null;
        secondary_color?: string | null;
      } | null;

      const nextPrimary = updatedOrg?.primary_color || primaryColor;
      const nextSecondary = updatedOrg?.secondary_color || secondaryColor;

      setLogoUrl(updatedOrg?.logo_url ?? logoUrl);
      setPrimaryColor(nextPrimary);
      setSecondaryColor(nextSecondary);
      setBrandSuccess("Branding updated for this organization.");
      setSelectedLogo(null);
      setLogoPreview(null);
      applyThemeLocally(nextPrimary, nextSecondary);
      router.refresh();
    } catch (err) {
      setBrandError(err instanceof Error ? err.message : "Unable to save branding");
    } finally {
      setBrandSaving(false);
    }
  };

  // --- Permission role save helpers ---

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

  const displayLogo = logoPreview || logoUrl;
  const isAdmin = role === "admin";

  const handleNameSave = async () => {
    if (!orgId) return;
    if (role !== "admin") {
      setNameError("Only admins can change the organization name.");
      return;
    }

    const validation = validateOrgName(editedOrgName);
    if (!validation.valid) {
      setNameError(validation.error || "Invalid organization name");
      return;
    }

    setNameSaving(true);
    setNameError(null);
    setNameSuccess(null);

    try {
      const res = await fetch(`/api/organizations/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editedOrgName.trim() }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || "Unable to update organization name");
      }

      const updatedName = data?.name || editedOrgName.trim();
      setOrgName(updatedName);
      setEditedOrgName(updatedName);
      setNameSuccess("Organization name updated successfully.");
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "Unable to update organization name");
    } finally {
      setNameSaving(false);
    }
  };

  // Storage usage progress bar color
  const storageBarColor = storageStats
    ? storageStats.usage_percent > 90
      ? "bg-red-500"
      : storageStats.usage_percent > 80
        ? "bg-yellow-500"
        : "bg-green-500"
    : "bg-green-500";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customization"
        description="Update your org brand and notifications in one place."
        backHref={`/${orgSlug}`}
      />

      {loading ? (
        <Card className="p-5 text-muted-foreground text-sm">Loading settings…</Card>
      ) : pageError ? (
        <Card className="p-5 text-red-600 dark:text-red-400 text-sm">{pageError}</Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* Organization Name Card */}
          <Card className="org-settings-card p-5 space-y-4 opacity-0 translate-y-2 lg:col-span-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-foreground">Organization name</p>
                <p className="text-sm text-muted-foreground">
                  Change your organization&apos;s display name.
                </p>
              </div>
              <Badge variant={isAdmin ? "muted" : "warning"}>{isAdmin ? "Admin" : "View only"}</Badge>
            </div>

            <div className="max-w-md space-y-4">
              {isAdmin ? (
                <Input
                  label="Name"
                  type="text"
                  value={editedOrgName}
                  onChange={(e) => {
                    setEditedOrgName(e.target.value);
                    setNameSuccess(null);
                    setNameError(null);
                  }}
                  placeholder="Organization name"
                  maxLength={100}
                />
              ) : (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">Name</p>
                  <p className="text-foreground">{orgName}</p>
                </div>
              )}
            </div>

            {nameSuccess && <div className="text-sm text-green-600 dark:text-green-400">{nameSuccess}</div>}
            {nameError && <div className="text-sm text-red-600 dark:text-red-400">{nameError}</div>}
            {!isAdmin && (
              <div className="text-sm text-muted-foreground">
                Only admins can change the organization name.
              </div>
            )}

            {isAdmin && (
              <div className="flex justify-end pt-1">
                <Button
                  onClick={handleNameSave}
                  isLoading={nameSaving}
                  disabled={editedOrgName.trim() === orgName}
                >
                  Save name
                </Button>
              </div>
            )}
          </Card>

          <Card className="org-settings-card p-5 space-y-4 opacity-0 translate-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-foreground">Organization branding</p>
                <p className="text-sm text-muted-foreground">
                  Upload a logo and set the colors used across your org experience.
                </p>
              </div>
              <Badge variant={isAdmin ? "muted" : "warning"}>{isAdmin ? "Admin" : "View only"}</Badge>
            </div>

            <div
              className="org-brand-preview relative overflow-hidden rounded-2xl border border-border p-5 shadow-soft"
              style={{
                backgroundColor: primaryColor,
              }}
            >
              <div className="absolute inset-0 bg-black/5 dark:bg-black/20" />
              <div className="relative flex items-center gap-4">
                {displayLogo ? (
                  <div className="relative h-14 w-14 rounded-2xl overflow-hidden border border-white/40 shadow-lg">
                    <Image
                      src={displayLogo}
                      alt={orgName}
                      fill
                      className="object-cover"
                      sizes="56px"
                    />
                  </div>
                ) : (
                  <div className="h-14 w-14 rounded-2xl flex items-center justify-center text-white font-bold text-lg bg-white/20 shadow-lg">
                    {orgName.charAt(0)}
                  </div>
                )}
                <div>
                  <p className="font-semibold text-white">{orgName}</p>
                  <p className="text-sm text-white/80 truncate">/{orgSlug}</p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setSelectedLogo(file);
                    setBrandError(null);
                    setBrandSuccess(null);
                  }}
                  disabled={!isAdmin}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!isAdmin}
                >
                  Upload organization photo
                </Button>
                {selectedLogo && (
                  <p className="text-sm text-muted-foreground truncate">
                    {selectedLogo.name} ({Math.round(selectedLogo.size / 1024)} KB)
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Primary color</p>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => {
                        setPrimaryColor(e.target.value);
                        setBrandSuccess(null);
                      }}
                      disabled={!isAdmin}
                      className="h-11 w-16 rounded-xl border border-border cursor-pointer bg-card"
                    />
                    <Input
                      type="text"
                      value={primaryColor}
                      onChange={(e) => {
                        setPrimaryColor(e.target.value);
                        setBrandSuccess(null);
                      }}
                      disabled={!isAdmin}
                      placeholder="#1e3a5f"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Buttons and highlights will use this color.
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Secondary color</p>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={secondaryColor}
                      onChange={(e) => {
                        setSecondaryColor(e.target.value);
                        setBrandSuccess(null);
                      }}
                      disabled={!isAdmin}
                      className="h-11 w-16 rounded-xl border border-border cursor-pointer bg-card"
                    />
                    <Input
                      type="text"
                      value={secondaryColor}
                      onChange={(e) => {
                        setSecondaryColor(e.target.value);
                        setBrandSuccess(null);
                      }}
                      disabled={!isAdmin}
                      placeholder="#10b981"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Accent surfaces and pills pull from this color.
                  </p>
                </div>
              </div>
            </div>

            {brandSuccess && <div className="text-sm text-green-600 dark:text-green-400">{brandSuccess}</div>}
            {brandError && <div className="text-sm text-red-600 dark:text-red-400">{brandError}</div>}
            {!isAdmin && (
              <div className="text-sm text-muted-foreground">
                Only admins can change branding. Ask an admin to update colors or the logo.
              </div>
            )}

            <div className="flex justify-end pt-1">
              <Button onClick={handleBrandingSave} isLoading={brandSaving} disabled={!isAdmin}>
                Save branding
              </Button>
            </div>
          </Card>

          <Card className="org-settings-card p-5 space-y-4 opacity-0 translate-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-foreground">Notification preferences</p>
                <p className="text-sm text-muted-foreground">
                  Applies only to {orgName}. Customize how you get alerts.
                </p>
              </div>
              <Badge variant="muted">{orgName}</Badge>
            </div>

            <div className="max-w-md space-y-4">
              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setPrefSuccess(null);
                }}
                placeholder="you@example.com"
              />

              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-medium text-sm text-foreground">Email notifications</span>
                  <p className="text-xs text-muted-foreground">Send emails for this org.</p>
                </div>
                <ToggleSwitch
                  checked={emailEnabled}
                  onChange={(v) => {
                    setEmailEnabled(v);
                    setPrefSuccess(null);
                  }}
                />
              </div>

              <div
                className={`overflow-hidden transition-all duration-300 ease-in-out ${
                  emailEnabled ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
                }`}
              >
                <div className="rounded-xl bg-muted/40 border border-border p-4 space-y-0">
                  <p className="text-xs font-medium text-muted-foreground mb-3">Choose which emails you receive:</p>
                  {([
                    { key: "announcement" as const, label: "Announcements", desc: "New announcements from org", checked: announcementEnabled, set: setAnnouncementEnabled, icon: <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 11 18-5v12L3 13v-2z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg> },
                    { key: "discussion" as const, label: "Discussions", desc: "New discussion threads", checked: discussionEnabled, set: setDiscussionEnabled, icon: <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> },
                    { key: "event" as const, label: "Events", desc: "New events and schedules", checked: eventEnabled, set: setEventEnabled, icon: <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> },
                    { key: "workout" as const, label: "Workouts", desc: "New workout plans", checked: workoutEnabled, set: setWorkoutEnabled, icon: <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 6.5h11"/><path d="M6.5 17.5h11"/><path d="M4 6.5a2.5 2.5 0 0 1 0-5h0a2.5 2.5 0 0 1 0 5"/><path d="M20 6.5a2.5 2.5 0 0 0 0-5h0a2.5 2.5 0 0 0 0 5"/><path d="M4 17.5a2.5 2.5 0 0 0 0 5h0a2.5 2.5 0 0 0 0-5"/><path d="M20 17.5a2.5 2.5 0 0 1 0 5h0a2.5 2.5 0 0 1 0-5"/><line x1="12" y1="1.5" x2="12" y2="22.5"/></svg> },
                    { key: "competition" as const, label: "Competitions", desc: "New competition updates", checked: competitionEnabled, set: setCompetitionEnabled, icon: <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg> },
                  ] as const).map((item, i, arr) => (
                    <div
                      key={item.key}
                      className={`flex items-center justify-between gap-3 py-3 ${
                        i < arr.length - 1 ? "border-b border-border" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {item.icon}
                        <div>
                          <p className="text-sm font-medium text-foreground">{item.label}</p>
                          <p className="text-xs text-muted-foreground">{item.desc}</p>
                        </div>
                      </div>
                      <ToggleSwitch
                        size="sm"
                        checked={item.checked}
                        onChange={(v) => {
                          item.set(v);
                          setPrefSuccess(null);
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {prefSuccess && <div className="text-sm text-green-600 dark:text-green-400">{prefSuccess}</div>}
            {prefError && <div className="text-sm text-red-600 dark:text-red-400">{prefError}</div>}

            <div className="flex justify-end pt-1">
              <Button onClick={handlePreferenceSave} isLoading={prefSaving}>
                Save preferences
              </Button>
            </div>
          </Card>

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
          {isAdmin && storageStats && (
            <Card className="org-settings-card p-5 space-y-4 opacity-0 translate-y-2 lg:col-span-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">Media storage usage</p>
                  <p className="text-sm text-muted-foreground">
                    Storage consumed by gallery items and feature uploads.
                  </p>
                </div>
                <Badge variant={storageStats.over_quota || storageStats.usage_percent > 90 ? "warning" : "muted"}>
                  {storageStats.quota_bytes === null ? "Unlimited" : `${Math.round(storageStats.usage_percent)}%`}
                </Badge>
              </div>

              {/* Progress bar */}
              {storageStats.quota_bytes !== null && (
                <div className="space-y-2">
                  <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${storageBarColor}`}
                      style={{ width: `${Math.min(storageStats.usage_percent, 100)}%` }}
                    />
                  </div>
                  <p className="text-sm text-foreground">
                    {formatBytes(storageStats.total_bytes)} of {formatBytes(storageStats.quota_bytes)} used
                  </p>
                </div>
              )}

              {storageStats.quota_bytes === null && (
                <p className="text-sm text-foreground">
                  {formatBytes(storageStats.total_bytes)} used (unlimited plan)
                </p>
              )}

              {/* Warning messages */}
              {storageStats.over_quota && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  Storage quota exceeded. Consider removing unused media or upgrading your plan.
                </p>
              )}
              {!storageStats.over_quota && storageStats.usage_percent > 80 && storageStats.quota_bytes !== null && (
                <p className="text-sm text-yellow-600 dark:text-yellow-400">
                  Approaching storage limit. Consider removing unused media or upgrading your plan.
                </p>
              )}

              {/* Item counts */}
              <p className="text-xs text-muted-foreground">
                {storageStats.media_items_count} gallery item{storageStats.media_items_count !== 1 ? "s" : ""}, {storageStats.media_uploads_count} feature upload{storageStats.media_uploads_count !== 1 ? "s" : ""}
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
