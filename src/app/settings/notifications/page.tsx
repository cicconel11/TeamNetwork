"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Card } from "@/components/ui";

interface OrgPreference {
  id: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  email_enabled: boolean;
  sms_enabled: boolean;
  email_address: string | null;
  phone_number: string | null;
}

export default function NotificationSettingsPage() {
  const [preferences, setPreferences] = useState<OrgPreference[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Fetch user's organizations and notification preferences
  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get user's organizations
      const { data: roles } = await supabase
        .from("user_organization_roles")
        .select(`
          organization_id,
          organizations (
            id,
            name,
            slug
          )
        `)
        .eq("user_id", user.id);

      const orgs = (roles || []).map(r => {
        const org = r.organizations as unknown as { id: string; name: string; slug: string };
        return org;
      }).filter(Boolean);

      // Get existing preferences
      const { data: prefs } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", user.id);

      // Merge preferences with orgs
      const mergedPrefs: OrgPreference[] = orgs.map(org => {
        const existing = (prefs || []).find(p => p.organization_id === org.id);
        return {
          id: existing?.id || "",
          organization_id: org.id,
          organization_name: org.name,
          organization_slug: org.slug,
          email_enabled: existing?.email_enabled ?? true,
          sms_enabled: existing?.sms_enabled ?? false,
          email_address: existing?.email_address ?? null,
          phone_number: existing?.phone_number ?? null,
        };
      });

      setPreferences(mergedPrefs);
      setIsLoading(false);
    };

    fetchData();
  }, []);

  const handleToggle = (orgId: string, field: "email_enabled" | "sms_enabled") => {
    setPreferences(prev =>
      prev.map(p =>
        p.organization_id === orgId
          ? { ...p, [field]: !p[field] }
          : p
      )
    );
  };

  const handleInputChange = (orgId: string, field: "email_address" | "phone_number", value: string) => {
    setPreferences(prev =>
      prev.map(p =>
        p.organization_id === orgId
          ? { ...p, [field]: value || null }
          : p
      )
    );
  };

  const handleSave = async (orgId: string) => {
    setIsSaving(orgId);
    setMessage(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setMessage({ type: "error", text: "You must be logged in" });
      setIsSaving(null);
      return;
    }

    const pref = preferences.find(p => p.organization_id === orgId);
    if (!pref) return;

    const data = {
      user_id: user.id,
      organization_id: orgId,
      email_enabled: pref.email_enabled,
      sms_enabled: pref.sms_enabled,
      email_address: pref.email_address,
      phone_number: pref.phone_number,
      updated_at: new Date().toISOString(),
    };

    let error;
    if (pref.id) {
      // Update existing
      const result = await supabase
        .from("notification_preferences")
        .update(data)
        .eq("id", pref.id);
      error = result.error;
    } else {
      // Insert new
      const result = await supabase
        .from("notification_preferences")
        .insert(data)
        .select()
        .single();
      error = result.error;
      if (result.data) {
        setPreferences(prev =>
          prev.map(p =>
            p.organization_id === orgId
              ? { ...p, id: result.data.id }
              : p
          )
        );
      }
    }

    if (error) {
      setMessage({ type: "error", text: error.message });
    } else {
      setMessage({ type: "success", text: "Preferences saved!" });
    }

    setIsSaving(null);

    // Clear success message after 3 seconds
    if (!error) {
      setTimeout(() => setMessage(null), 3000);
    }
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-64 bg-muted rounded-xl" />
        <div className="h-4 w-96 bg-muted rounded-xl" />
        <Card className="p-6">
          <div className="h-32 bg-muted rounded-xl" />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">Notification Preferences</h1>
        <p className="text-muted-foreground">
          Manage how you receive notifications from your organizations.
        </p>
      </div>

      {message && (
        <div
          className={`mb-6 p-4 rounded-xl text-sm ${
            message.type === "success"
              ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400"
              : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
          }`}
        >
          {message.text}
        </div>
      )}

      {preferences.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">
            You&apos;re not a member of any organizations yet.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          {preferences.map((pref) => (
            <Card key={pref.organization_id} className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="font-semibold text-foreground">{pref.organization_name}</h3>
                  <p className="text-sm text-muted-foreground">/{pref.organization_slug}</p>
                </div>
                <Button
                  size="sm"
                  onClick={() => handleSave(pref.organization_id)}
                  isLoading={isSaving === pref.organization_id}
                >
                  Save
                </Button>
              </div>

              <div className="space-y-6">
                {/* Email Preferences */}
                <div className="flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <button
                        type="button"
                        onClick={() => handleToggle(pref.organization_id, "email_enabled")}
                        className={`relative w-11 h-6 rounded-full transition-colors ${
                          pref.email_enabled ? "bg-emerald-500" : "bg-muted"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                            pref.email_enabled ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                      <label className="font-medium text-foreground">Email Notifications</label>
                    </div>
                    {pref.email_enabled && (
                      <Input
                        type="email"
                        placeholder="Override email (optional)"
                        value={pref.email_address || ""}
                        onChange={(e) => handleInputChange(pref.organization_id, "email_address", e.target.value)}
                        helperText="Leave blank to use your account email"
                      />
                    )}
                  </div>
                </div>

                {/* SMS Preferences */}
                <div className="flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <button
                        type="button"
                        onClick={() => handleToggle(pref.organization_id, "sms_enabled")}
                        className={`relative w-11 h-6 rounded-full transition-colors ${
                          pref.sms_enabled ? "bg-emerald-500" : "bg-muted"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                            pref.sms_enabled ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                      <label className="font-medium text-foreground">SMS Notifications</label>
                    </div>
                    {pref.sms_enabled && (
                      <Input
                        type="tel"
                        placeholder="+1 (555) 123-4567"
                        value={pref.phone_number || ""}
                        onChange={(e) => handleInputChange(pref.organization_id, "phone_number", e.target.value)}
                        helperText="Your phone number for SMS notifications"
                      />
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

