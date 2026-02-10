"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { NotificationPreference } from "@/types/database";
import { Card, Button, Badge, Input } from "@/components/ui";

type OrgPrefForm = {
  orgId: string;
  orgName: string;
  orgSlug: string;
  email: string;
  emailEnabled: boolean;
  prefId?: string;
  isSaving?: boolean;
  error?: string | null;
  success?: string | null;
};

export default function NotificationSettingsPage() {
  return (
    <Suspense fallback={<NotificationSettingsLoading />}>
      <NotificationSettingsContent />
    </Suspense>
  );
}

function NotificationSettingsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Settings</p>
        <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
        <p className="text-muted-foreground">
          Choose how you want to receive email notifications for each organization.
        </p>
      </div>
      <Card className="p-5 text-muted-foreground text-sm">Loading…</Card>
    </div>
  );
}

function NotificationSettingsContent() {
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState<OrgPrefForm[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    const load = async () => {
      if (!supabase) {
        setLoadError("Failed to initialize client.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setLoadError("You need to be signed in to manage notifications.");
        setLoading(false);
        return;
      }

      const [{ data: memberships }, { data: prefs }] = await Promise.all([
        supabase
          .from("user_organization_roles")
          .select("organization_id, organizations(name, slug)")
          .eq("user_id", user.id)
          .eq("status", "active"),
        supabase
          .from("notification_preferences")
          .select("*")
          .eq("user_id", user.id),
      ]);

      const prefByOrg = new Map<string, NotificationPreference>();
      ((prefs || []) as NotificationPreference[]).forEach((p) => {
        prefByOrg.set(p.organization_id, p);
      });

      const nextForms: OrgPrefForm[] =
        memberships?.map((m) => {
          const org = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
          const pref = prefByOrg.get(m.organization_id);
          return {
            orgId: m.organization_id,
            orgName: org?.name || "Organization",
            orgSlug: org?.slug || "",
            email: pref?.email_address || user.email || "",
            emailEnabled: pref?.email_enabled ?? true,
            prefId: pref?.id,
            isSaving: false,
            error: null,
            success: null,
          };
        }) || [];

      setForms(nextForms);
      setLoading(false);
    };

    load();
  }, [supabase]);

  const updateForm = (orgId: string, updater: (form: OrgPrefForm) => OrgPrefForm) => {
    setForms((prev) => prev.map((f) => (f.orgId === orgId ? updater(f) : f)));
  };

  const handleSave = async (orgId: string) => {
    if (!supabase) return;

    const form = forms.find((f) => f.orgId === orgId);
    if (!form) return;

    updateForm(orgId, (f) => ({ ...f, isSaving: true, success: null, error: null }));

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      updateForm(orgId, (f) => ({ ...f, isSaving: false, error: "You must be signed in." }));
      return;
    }

    const { error, data } = await supabase
      .from("notification_preferences")
      .upsert({
        id: form.prefId,
        organization_id: orgId,
        user_id: user.id,
        email_address: form.email.trim() || null,
        email_enabled: form.emailEnabled,
        phone_number: null,
        sms_enabled: false,
      })
      .select()
      .maybeSingle();

    if (error) {
      updateForm(orgId, (f) => ({ ...f, isSaving: false, error: error.message }));
      return;
    }

    updateForm(orgId, (f) => ({
      ...f,
      isSaving: false,
      prefId: data?.id || f.prefId,
      success: "Preferences saved",
    }));
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Settings</p>
        <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
        <p className="text-muted-foreground">
          Choose how you want to receive email notifications for each organization.
        </p>
      </div>

      {loadError && (
        <Card className="p-4 bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300">
          {loadError}
        </Card>
      )}

      {/* Calendar Sync info card */}
      <Card className="p-5 space-y-3">
        <p className="font-medium text-foreground">Calendar Sync</p>
        <p className="text-sm text-muted-foreground">
          Google Calendar sync is managed per-organization in the Schedules section.
        </p>
      </Card>

      {/* Email Notifications Section */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-foreground">Email Notifications</h2>
        <p className="text-sm text-muted-foreground">
          Configure email notification preferences for each organization.
        </p>
      </div>

      {loading ? (
        <Card className="p-5 text-muted-foreground text-sm">Loading your organizations…</Card>
      ) : forms.length === 0 ? (
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-foreground">Join an organization</p>
              <p className="text-sm text-muted-foreground">
                You will see notification options for each organization you belong to.
              </p>
            </div>
            <Link href="/app">
              <Button size="sm" variant="secondary">Go to Organizations</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {forms.map((form) => (
            <Card key={form.orgId} className="p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-foreground">{form.orgName}</p>
                  <p className="text-sm text-muted-foreground">Control how you get updates from this org.</p>
                </div>
                <Badge variant="muted">{form.orgSlug || "org"}</Badge>
              </div>

              <div className="max-w-md">
                <Input
                  label="Email"
                  type="email"
                  value={form.email}
                  onChange={(e) =>
                    updateForm(form.orgId, (f) => ({ ...f, email: e.target.value, success: null }))
                  }
                  placeholder="you@example.com"
                />
              </div>

              <label htmlFor={`email-${form.orgId}`} className="flex items-center gap-3 cursor-pointer">
                <input
                  id={`email-${form.orgId}`}
                  type="checkbox"
                  className="h-4 w-4 rounded border-border"
                  checked={form.emailEnabled}
                  onChange={(e) =>
                    updateForm(form.orgId, (f) => ({
                      ...f,
                      emailEnabled: e.target.checked,
                      success: null,
                    }))
                  }
                />
                <div>
                  <span className="font-medium text-sm text-foreground">Email notifications</span>
                  <p className="text-xs text-muted-foreground">Turn emails on or off for this org.</p>
                </div>
              </label>

              {form.error && (
                <div className="text-sm text-red-600 dark:text-red-400">{form.error}</div>
              )}
              {form.success && (
                <div className="text-sm text-green-600 dark:text-green-400">{form.success}</div>
              )}

              <div className="flex justify-end">
                <Button onClick={() => handleSave(form.orgId)} isLoading={form.isSaving}>
                  Save preferences
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Analytics Consent */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-foreground">Usage Analytics</h2>
        <p className="text-sm text-muted-foreground">
          Control anonymous usage pattern tracking.
        </p>
      </div>

      <Card className="p-5 space-y-3">
        <div>
          <p className="font-medium text-foreground">Account emails</p>
          <p className="text-sm text-muted-foreground">
            Critical account and billing emails always go to your account email.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="success">Enabled</Badge>
          <span>Cannot be turned off</span>
        </div>
      </Card>
    </div>
  );
}
