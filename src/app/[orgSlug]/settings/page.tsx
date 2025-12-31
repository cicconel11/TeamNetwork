"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { NotificationPreference } from "@/types/database";
import { Card, Button, Badge, Input } from "@/components/ui";
import { PageHeader } from "@/components/layout";

export default function OrgSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const orgSlug = params.orgSlug as string;
  const supabase = useMemo(() => createClient(), []);

  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string>("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [prefId, setPrefId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);

      const { data: org } = await supabase
        .from("organizations")
        .select("id, name")
        .eq("slug", orgSlug)
        .maybeSingle();

      if (!org?.id) {
        setError("Organization not found");
        setLoading(false);
        return;
      }

      setOrgId(org.id);
      setOrgName(org.name || "Organization");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError("You must be signed in.");
        setLoading(false);
        router.push(`/auth/login?redirect=/${orgSlug}/settings`);
        return;
      }

      const { data: membership } = await supabase
        .from("user_organization_roles")
        .select("status")
        .eq("organization_id", org.id)
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();

      if (!membership) {
        setError("You do not have access to this organization.");
        setLoading(false);
        return;
      }

      const { data: pref } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("organization_id", org.id)
        .eq("user_id", user.id)
        .maybeSingle();

      const typedPref = pref as NotificationPreference | null;
      setEmail(typedPref?.email_address || user.email || "");
      setPhone(typedPref?.phone_number || "");
      setEmailEnabled(typedPref?.email_enabled ?? true);
      setSmsEnabled(typedPref?.sms_enabled ?? false);
      setPrefId(typedPref?.id || null);
      setLoading(false);
    };

    load();
  }, [orgSlug, router, supabase]);

  const handleSave = async () => {
    if (!orgId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("You must be signed in.");
      setSaving(false);
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
        phone_number: phone.trim() || null,
        sms_enabled: smsEnabled,
      })
      .select("id")
      .maybeSingle();

    if (upsertError) {
      setError(upsertError.message);
      setSaving(false);
      return;
    }

    setPrefId(data?.id || prefId);
    setSaving(false);
    setSuccess("Preferences saved for this organization.");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Notification preferences for this organization."
        backHref={`/${orgSlug}`}
      />

      {loading ? (
        <Card className="p-5 text-muted-foreground text-sm">Loading settings…</Card>
      ) : error ? (
        <Card className="p-5 text-red-600 dark:text-red-400 text-sm">{error}</Card>
      ) : (
        <Card className="p-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-foreground">Notification preferences</p>
              <p className="text-sm text-muted-foreground">
                Applies only to {orgName}. Customize how you get alerts.
              </p>
            </div>
            <Badge variant="muted">{orgName}</Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setSuccess(null);
              }}
              placeholder="you@example.com"
            />
            <Input
              label="Phone (for texts)"
              type="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setSuccess(null);
              }}
              placeholder="e.g., +1 555 123 4567"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border"
                checked={emailEnabled}
                onChange={(e) => {
                  setEmailEnabled(e.target.checked);
                  setSuccess(null);
                }}
              />
              <div>
                <span className="font-medium text-sm text-foreground">Email notifications</span>
                <p className="text-xs text-muted-foreground">Send emails for this org.</p>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border"
                checked={smsEnabled}
                onChange={(e) => {
                  setSmsEnabled(e.target.checked);
                  setSuccess(null);
                }}
              />
              <div>
                <span className="font-medium text-sm text-foreground">Text notifications</span>
                <p className="text-xs text-muted-foreground">Uses the phone number above.</p>
              </div>
            </label>
          </div>

          {success && <div className="text-sm text-green-600 dark:text-green-400">{success}</div>}
          {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}

          <div className="flex justify-end">
            <Button onClick={handleSave} isLoading={saving}>
              Save preferences
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
