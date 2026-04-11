"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { animate, stagger } from "animejs";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import type { NotificationPreference, UserRole } from "@/types/database";
import { normalizeRole, type OrgRole } from "@/lib/auth/role-utils";
import { Card, Button, Select } from "@/components/ui";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { PermissionRoleCard } from "@/components/ui/PermissionRoleCard";
import { PageHeader } from "@/components/layout";
import { OrgNameCard } from "@/components/settings/OrgNameCard";
import { BrandingCard } from "@/components/settings/BrandingCard";
import { NotificationPrefsCard } from "@/components/settings/NotificationPrefsCard";
import { LOCALE_NAMES } from "@/i18n/config";
import type { SupportedLocale } from "@/i18n/config";
import { getCustomizationTimezoneOptions } from "@/lib/i18n/customization-timezones";

const LANGUAGE_OPTIONS = (Object.entries(LOCALE_NAMES) as [SupportedLocale, string][]).map(
  ([value, label]) => ({ value, label })
);

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
  const tCustom = useTranslations("customization");
  const tCommon = useTranslations("common");

  return (
    <div className="space-y-6">
      <PageHeader
        title={tCustom("title")}
        description={tCustom("description")}
        backHref={`/${orgSlug}`}
      />
      <Card className="p-5 text-muted-foreground text-sm">{tCommon("loading")}</Card>
    </div>
  );
}

function OrgSettingsContent() {
  const params = useParams();
  const router = useRouter();
  const orgSlug = params.orgSlug as string;
  const supabase = useMemo(() => createClient(), []);
  const tCustom = useTranslations("customization");
  const tCommon = useTranslations("common");
  const timezoneOptions = useMemo(() => getCustomizationTimezoneOptions((key) => tCustom(key)), [tCustom]);

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

  // Timezone state
  const [timezone, setTimezone] = useState("America/New_York");
  const [timezoneSaving, setTimezoneSaving] = useState(false);
  const [timezoneError, setTimezoneError] = useState<string | null>(null);
  const [timezoneSuccess, setTimezoneSuccess] = useState<string | null>(null);

  // Language state
  const [defaultLanguage, setDefaultLanguage] = useState("en");
  const [languageSaving, setLanguageSaving] = useState(false);
  const [languageError, setLanguageError] = useState<string | null>(null);
  const [languageSuccess, setLanguageSuccess] = useState<string | null>(null);

  // LinkedIn resync toggle state
  const [linkedinResyncEnabled, setLinkedinResyncEnabled] = useState(false);
  const [linkedinResyncSaving, setLinkedinResyncSaving] = useState(false);
  const [linkedinResyncError, setLinkedinResyncError] = useState<string | null>(null);
  const [linkedinResyncSuccess, setLinkedinResyncSuccess] = useState<string | null>(null);

  // Bootstrap fetch
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setPageError(null);

      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .select("id, name, logo_url, primary_color, secondary_color, feed_post_roles, job_post_roles, discussion_post_roles, media_upload_roles, linkedin_resync_enabled, timezone, default_language")
        .eq("slug", orgSlug)
        .maybeSingle();

      if (!org || orgError) {
        setPageError(orgError?.message || tCustom("errors.orgNotFound"));
        setLoading(false);
        return;
      }

      setOrgId(org.id);
      setOrgName(org.name || tCustom("fallbackOrgName"));
      setInitialLogoUrl(org.logo_url);
      setInitialPrimaryColor(org.primary_color || "#1e3a5f");
      setInitialSecondaryColor(org.secondary_color || "#10b981");
      setFeedPostRoles((org as Record<string, unknown>).feed_post_roles as string[] || ["admin", "active_member", "alumni"]);
      setJobPostRoles((org as Record<string, unknown>).job_post_roles as string[] || ["admin", "alumni"]);
      setDiscussionPostRoles((org as Record<string, unknown>).discussion_post_roles as string[] || ["admin", "active_member", "alumni"]);
      setMediaUploadRoles((org as Record<string, unknown>).media_upload_roles as string[] || ["admin"]);
      setLinkedinResyncEnabled((org as Record<string, unknown>).linkedin_resync_enabled === true);
      setTimezone(((org as Record<string, unknown>).timezone as string) || "America/New_York");
      setDefaultLanguage(((org as Record<string, unknown>).default_language as string) || "en");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setPageError(tCustom("errors.mustBeSignedIn"));
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
        setPageError(tCustom("errors.noAccess"));
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
  }, [orgSlug, router, supabase, tCustom]);

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
        setErr(tCustom("permissions.adminOnlyChange", { feature: label }));
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
          throw new Error(data?.error || tCustom("permissions.unableToUpdate", { feature: label }));
        }

        if (data?.[field]) {
          setRoles(data[field]);
        }
        setSucc(tCustom("permissions.updated", { feature: label }));
      } catch (err) {
        setErr(err instanceof Error ? err.message : tCustom("permissions.unableToUpdate", { feature: label }));
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

  const handleFeedRolesSave = makeRoleSaveHandler("feed_post_roles", feedPostRoles, setFeedSaving, setFeedError, setFeedSuccess, setFeedPostRoles, tCustom("permissions.feedTitle"));
  const toggleFeedRole = makeToggleHandler(setFeedPostRoles, setFeedSuccess);

  const handleDiscussionRolesSave = makeRoleSaveHandler("discussion_post_roles", discussionPostRoles, setDiscussionSaving, setDiscussionError, setDiscussionSuccess, setDiscussionPostRoles, tCustom("permissions.discussionTitle"));
  const toggleDiscussionRole = makeToggleHandler(setDiscussionPostRoles, setDiscussionSuccess);

  const handleJobRolesSave = makeRoleSaveHandler("job_post_roles", jobPostRoles, setJobSaving, setJobError, setJobSuccess, setJobPostRoles, tCustom("permissions.jobTitle"));
  const toggleJobRole = makeToggleHandler(setJobPostRoles, setJobSuccess);

  const handleMediaRolesSave = makeRoleSaveHandler("media_upload_roles", mediaUploadRoles, setMediaSaving, setMediaError, setMediaSuccess, setMediaUploadRoles, tCustom("permissions.mediaTitle"));
  const toggleMediaRole = makeToggleHandler(setMediaUploadRoles, setMediaSuccess);

  const handleLinkedinResyncToggle = async (enabled: boolean) => {
    if (!orgId) return;
    if (role !== "admin") {
      setLinkedinResyncError(tCustom("linkedin.adminOnly"));
      return;
    }

    setLinkedinResyncEnabled(enabled);
    setLinkedinResyncSaving(true);
    setLinkedinResyncError(null);
    setLinkedinResyncSuccess(null);

    try {
      const res = await fetch(`/api/organizations/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedin_resync_enabled: enabled }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setLinkedinResyncEnabled(!enabled); // revert
        throw new Error(data?.error || tCustom("linkedin.unableToUpdate"));
      }

      if (typeof data?.linkedin_resync_enabled === "boolean") {
        setLinkedinResyncEnabled(data.linkedin_resync_enabled);
      }
      setLinkedinResyncSuccess(enabled ? tCustom("linkedin.enabled") : tCustom("linkedin.disabled"));
    } catch (err) {
      setLinkedinResyncError(err instanceof Error ? err.message : tCustom("linkedin.unableToUpdate"));
    } finally {
      setLinkedinResyncSaving(false);
    }
  };

  const handleTimezoneSave = async () => {
    if (!orgId) return;
    if (role !== "admin") {
      setTimezoneError(tCustom("timezone.adminOnly"));
      return;
    }

    setTimezoneSaving(true);
    setTimezoneError(null);
    setTimezoneSuccess(null);

    try {
      const res = await fetch(`/api/organizations/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || tCustom("timezone.unableToUpdate"));
      }

      if (data?.timezone) {
        setTimezone(data.timezone);
      }
      setTimezoneSuccess(tCustom("timezone.saved"));
    } catch (err) {
      setTimezoneError(err instanceof Error ? err.message : tCustom("timezone.unableToUpdate"));
    } finally {
      setTimezoneSaving(false);
    }
  };

  const handleLanguageSave = async () => {
    if (!orgId) return;
    if (role !== "admin") {
      setLanguageError(tCustom("errors.adminOnlyLanguage"));
      return;
    }

    setLanguageSaving(true);
    setLanguageError(null);
    setLanguageSuccess(null);

    try {
      const res = await fetch(`/api/organizations/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_language: defaultLanguage }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || tCustom("errors.unableToUpdateLanguage"));
      }

      if (data?.default_language) {
        setDefaultLanguage(data.default_language);
      }

      // Also clear the admin's personal language override so they immediately
      // see the org default they just chose. Without this, their personal
      // override (e.g. 'en') takes priority and the change appears to do nothing.
      const supabase = (await import("@/lib/supabase/client")).createClient();
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (currentUser) {
        await supabase
          .from("users")
          .update({ language_override: null })
          .eq("id", currentUser.id);
      }

      // Clear the cookie so middleware re-resolves the correct locale from DB.
      const secure = window.location.protocol === "https:" ? ";secure" : "";
      document.cookie = `NEXT_LOCALE=;path=/;max-age=0${secure}`;

      // Full reload so next-intl's getRequestConfig re-reads the cookie and
      // loads the correct message bundle. router.refresh() is insufficient
      // because it doesn't re-run middleware or re-evaluate getRequestConfig.
      window.location.reload();
      return; // skip finally while reloading
    } catch (err) {
      setLanguageError(err instanceof Error ? err.message : tCustom("errors.unableToUpdateLanguage"));
    } finally {
      setLanguageSaving(false);
    }
  };

  const isAdmin = role === "admin";

  return (
    <div className="space-y-6">
      <PageHeader
        title={tCustom("title")}
        description={tCustom("description")}
        backHref={`/${orgSlug}`}
      />

      {loading ? (
        <Card className="p-5 text-muted-foreground text-sm">{tCommon("loading")}</Card>
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

          {isAdmin && (
            <Card className="org-settings-card p-5 space-y-3 opacity-0 translate-y-2">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-foreground" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" />
                </svg>
                <p className="font-semibold text-foreground">{tCustom("timezone.title")}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                {tCustom("timezone.description")}
              </p>
              <Select
                label={tCustom("timezone.label")}
                options={timezoneOptions}
                value={timezone}
                onChange={(e) => { setTimezone(e.target.value); setTimezoneSuccess(null); }}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleTimezoneSave}
                disabled={timezoneSaving}
              >
                {timezoneSaving ? tCommon("saving") : tCommon("save")}
              </Button>
              {timezoneError && (
                <p className="text-sm text-red-600 dark:text-red-400">{timezoneError}</p>
              )}
              {timezoneSuccess && (
                <p className="text-sm text-green-600 dark:text-green-400">{timezoneSuccess}</p>
              )}
            </Card>
          )}

          {isAdmin && (
            <Card className="org-settings-card p-5 space-y-3 opacity-0 translate-y-2">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-foreground" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" />
                </svg>
                <p className="font-semibold text-foreground">{tCustom("language.title")}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                {tCustom("language.description")}
              </p>
              <Select
                label={tCustom("language.title")}
                options={LANGUAGE_OPTIONS}
                value={defaultLanguage}
                onChange={(e) => { setDefaultLanguage(e.target.value); setLanguageSuccess(null); }}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleLanguageSave}
                disabled={languageSaving}
              >
                {languageSaving ? tCommon("saving") : tCommon("save")}
              </Button>
              {languageError && (
                <p className="text-sm text-red-600 dark:text-red-400">{languageError}</p>
              )}
              {languageSuccess && (
                <p className="text-sm text-green-600 dark:text-green-400">{languageSuccess}</p>
              )}
            </Card>
          )}

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
              <p className="font-semibold text-foreground">{tCustom("googleCalendar.title")}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              {tCustom("googleCalendar.description")}
            </p>
            <Link href={`/${orgSlug}/calendar/my-settings`}>
              <Button variant="secondary" size="sm">{tCustom("googleCalendar.goToSync")}</Button>
            </Link>
          </Card>

          {/* Integrations — admin-only link to settings/integrations */}
          {isAdmin && (
            <Card className="org-settings-card p-5 space-y-3 opacity-0 translate-y-2">
              <div className="flex items-center gap-2">
                <svg
                  className="w-5 h-5 text-foreground"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
                </svg>
                <p className="font-semibold text-foreground">{tCustom("integrations.title")}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                {tCustom("integrations.description")}
              </p>
              <Link href={`/${orgSlug}/settings/integrations`}>
                <Button variant="secondary" size="sm">{tCustom("integrations.manage")}</Button>
              </Link>
            </Card>
          )}

          {/* Posting & Upload Permission Cards (admin-only) */}
          {isAdmin && (
            <PermissionRoleCard
              title={tCustom("permissions.feedTitle")}
              description={tCustom("permissions.feedDescription")}
              featureVerb={tCustom("permissions.feedVerb")}
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
              title={tCustom("permissions.discussionTitle")}
              description={tCustom("permissions.discussionDescription")}
              featureVerb={tCustom("permissions.discussionVerb")}
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
              title={tCustom("permissions.jobTitle")}
              description={tCustom("permissions.jobDescription")}
              featureVerb={tCustom("permissions.jobVerb")}
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
              title={tCustom("permissions.mediaTitle")}
              description={tCustom("permissions.mediaDescription")}
              featureVerb={tCustom("permissions.mediaVerb")}
              roles={mediaUploadRoles}
              onToggleRole={toggleMediaRole}
              onSave={handleMediaRolesSave}
              saving={mediaSaving}
              error={mediaError}
              success={mediaSuccess}
            />
          )}

          {/* LinkedIn Profile Sync Toggle (admin-only) */}
          {isAdmin && (
            <Card className="org-settings-card p-5 space-y-4 opacity-0 translate-y-2">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M2.985 14.652" />
                    </svg>
                    <p className="font-semibold text-foreground">{tCustom("linkedin.title")}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {tCustom("linkedin.description")}
                  </p>
                </div>
                <ToggleSwitch
                  checked={linkedinResyncEnabled}
                  onChange={handleLinkedinResyncToggle}
                  disabled={linkedinResyncSaving}
                  size="md"
                />
              </div>
              {linkedinResyncError && (
                <p className="text-sm text-red-600 dark:text-red-400">{linkedinResyncError}</p>
              )}
              {linkedinResyncSuccess && (
                <p className="text-sm text-green-600 dark:text-green-400">{linkedinResyncSuccess}</p>
              )}
            </Card>
          )}

        </div>
      )}
    </div>
  );
}
