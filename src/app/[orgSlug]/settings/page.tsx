"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { animate, stagger } from "animejs";
import { createClient } from "@/lib/supabase/client";
import type { NotificationPreference, UserRole } from "@/types/database";
import { normalizeRole, type OrgRole } from "@/lib/auth/role-utils";
import { Card, Button, Badge, Input } from "@/components/ui";
import { PageHeader } from "@/components/layout";

function adjustColor(hex: string, amount: number): string {
  const clamp = (num: number) => Math.min(255, Math.max(0, num));

  let color = hex.replace("#", "");
  if (color.length === 3) {
    color = color
      .split("")
      .map((c) => c + c)
      .join("");
  }

  const num = parseInt(color, 16);
  const r = clamp((num >> 16) + amount);
  const g = clamp(((num >> 8) & 0x00ff) + amount);
  const b = clamp((num & 0x0000ff) + amount);

  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function isColorDark(hex: string): boolean {
  let color = hex.replace("#", "");
  if (color.length === 3) {
    color = color
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const num = parseInt(color, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.6;
}

export default function OrgSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const orgSlug = params.orgSlug as string;
  const supabase = useMemo(() => createClient(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string>("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState("#1e3a5f");
  const [secondaryColor, setSecondaryColor] = useState("#10b981");
  const [role, setRole] = useState<OrgRole | null>(null);
  const [email, setEmail] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [prefId, setPrefId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [prefSaving, setPrefSaving] = useState(false);
  const [brandSaving, setBrandSaving] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [prefError, setPrefError] = useState<string | null>(null);
  const [prefSuccess, setPrefSuccess] = useState<string | null>(null);
  const [brandError, setBrandError] = useState<string | null>(null);
  const [brandSuccess, setBrandSuccess] = useState<string | null>(null);
  const [selectedLogo, setSelectedLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedLogo) return;
    const previewUrl = URL.createObjectURL(selectedLogo);
    setLogoPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [selectedLogo]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setPageError(null);

      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .select("id, name, logo_url, primary_color, secondary_color")
        .eq("slug", orgSlug)
        .maybeSingle();

      if (!org || orgError) {
        setPageError(orgError?.message || "Organization not found");
        setLoading(false);
        return;
      }

      setOrgId(org.id);
      setOrgName(org.name || "Organization");
      setLogoUrl(org.logo_url);
      setPrimaryColor(org.primary_color || "#1e3a5f");
      setSecondaryColor(org.secondary_color || "#10b981");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setPageError("You must be signed in.");
        setLoading(false);
        router.push(`/auth/login?redirect=/${orgSlug}/settings`);
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
      setPrefId(typedPref?.id || null);
      setLoading(false);
    };

    load();
  }, [orgSlug, router, supabase]);

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
    const shell = document.querySelector<HTMLElement>("[data-org-shell]");
    const target = shell || document.documentElement;
    const primaryLight = adjustColor(nextPrimary, 20);
    const primaryDark = adjustColor(nextPrimary, -20);
    const secondaryLight = adjustColor(nextSecondary, 20);
    const secondaryDark = adjustColor(nextSecondary, -20);
    const isPrimaryDark = isColorDark(nextPrimary);
    const baseForeground = isPrimaryDark ? "#f8fafc" : "#0f172a";
    const cardColor = isPrimaryDark ? adjustColor(nextPrimary, 18) : adjustColor(nextPrimary, -12);
    const cardForeground = isColorDark(cardColor) ? "#f8fafc" : "#0f172a";
    const muted = isPrimaryDark ? adjustColor(nextPrimary, 28) : adjustColor(nextPrimary, -20);
    const mutedForeground = isColorDark(muted) ? "#e2e8f0" : "#475569";
    const borderColor = isPrimaryDark ? adjustColor(nextPrimary, 35) : adjustColor(nextPrimary, -28);

    target.style.setProperty("--color-org-primary", nextPrimary);
    target.style.setProperty("--color-org-primary-light", primaryLight);
    target.style.setProperty("--color-org-primary-dark", primaryDark);
    target.style.setProperty("--color-org-secondary", nextSecondary);
    target.style.setProperty("--color-org-secondary-light", secondaryLight);
    target.style.setProperty("--color-org-secondary-dark", secondaryDark);
    target.style.setProperty("--background", nextPrimary);
    target.style.setProperty("--foreground", baseForeground);
    target.style.setProperty("--card", cardColor);
    target.style.setProperty("--card-foreground", cardForeground);
    target.style.setProperty("--muted", muted);
    target.style.setProperty("--muted-foreground", mutedForeground);
    target.style.setProperty("--border", borderColor);
    target.style.setProperty("--ring", nextSecondary);
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

  const displayLogo = logoPreview || logoUrl;
  const isAdmin = role === "admin";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Update your org brand and notifications in one place."
        backHref={`/${orgSlug}`}
      />

      {loading ? (
        <Card className="p-5 text-muted-foreground text-sm">Loading settings…</Card>
      ) : pageError ? (
        <Card className="p-5 text-red-600 dark:text-red-400 text-sm">{pageError}</Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="org-settings-card p-6 space-y-5 opacity-0 translate-y-2">
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

            <div className="flex justify-end">
              <Button onClick={handleBrandingSave} isLoading={brandSaving} disabled={!isAdmin}>
                Save branding
              </Button>
            </div>
          </Card>

          <Card className="org-settings-card p-6 space-y-5 opacity-0 translate-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-foreground">Notification preferences</p>
                <p className="text-sm text-muted-foreground">
                  Applies only to {orgName}. Customize how you get alerts.
                </p>
              </div>
              <Badge variant="muted">{orgName}</Badge>
            </div>

            <div className="max-w-md space-y-5">
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

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border"
                  checked={emailEnabled}
                  onChange={(e) => {
                    setEmailEnabled(e.target.checked);
                    setPrefSuccess(null);
                  }}
                />
                <div>
                  <span className="font-medium text-sm text-foreground">Email notifications</span>
                  <p className="text-xs text-muted-foreground">Send emails for this org.</p>
                </div>
              </label>
            </div>

            {prefSuccess && <div className="text-sm text-green-600 dark:text-green-400">{prefSuccess}</div>}
            {prefError && <div className="text-sm text-red-600 dark:text-red-400">{prefError}</div>}

            <div className="flex justify-end">
              <Button onClick={handlePreferenceSave} isLoading={prefSaving}>
                Save preferences
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
