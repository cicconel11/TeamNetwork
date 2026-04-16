"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { animate } from "animejs";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, Input } from "@/components/ui";
import { computeOrgThemeVariables, isColorDark } from "@/lib/theming/org-colors";
import { hexColorSchema } from "@/lib/schemas/common";

interface BrandingCardProps {
  orgId: string;
  orgSlug: string;
  orgName: string;
  isAdmin: boolean;
  initialLogoUrl: string | null;
  initialBaseColor: string;
  initialSidebarColor: string;
  initialButtonColor: string;
}

const BASE_PRIMARY = "primary";
const BASE_WHITE = "#ffffff";
const BASE_DARK = "#222326";

export function BrandingCard({
  orgId,
  orgSlug,
  orgName,
  isAdmin,
  initialLogoUrl,
  initialBaseColor,
  initialSidebarColor,
  initialButtonColor,
}: BrandingCardProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tSettings = useTranslations("settings");
  const tCommon = useTranslations("common");

  const [baseColor, setBaseColor] = useState(
    initialBaseColor === BASE_DARK ? BASE_DARK
    : initialBaseColor === BASE_WHITE ? BASE_WHITE
    : BASE_PRIMARY
  );
  const [sidebarColor, setSidebarColor] = useState(initialSidebarColor);
  const [buttonColor, setButtonColor] = useState(initialButtonColor);
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [selectedLogo, setSelectedLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [brandSaving, setBrandSaving] = useState(false);
  const [brandError, setBrandError] = useState<string | null>(null);
  const [brandSuccess, setBrandSuccess] = useState<string | null>(null);

  // Logo preview blob URL lifecycle
  useEffect(() => {
    if (!selectedLogo) return;
    const previewUrl = URL.createObjectURL(selectedLogo);
    setLogoPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [selectedLogo]);

  // Clean up theme preview style on unmount
  useEffect(() => {
    return () => {
      const existingStyle = document.getElementById("org-theme-preview");
      if (existingStyle) existingStyle.remove();
    };
  }, []);

  // Brand preview animation
  useEffect(() => {
    animate(".org-brand-preview", {
      scale: [0.98, 1],
      opacity: [0.9, 1],
      duration: 480,
      easing: "easeOutQuad",
    });
  }, [baseColor, sidebarColor, buttonColor, logoPreview, logoUrl]);

  const applyThemeLocally = (nextBase: string, nextSidebar: string, nextButton: string) => {
    const vars = computeOrgThemeVariables(nextBase, nextSidebar, nextButton);

    const existingStyle = document.getElementById("org-theme-preview");
    if (existingStyle) existingStyle.remove();

    const cssVars = Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join("\n        ");
    const style = document.createElement("style");
    style.id = "org-theme-preview";
    // Override :root, .dark, and prefers-color-scheme so base color always wins
    style.textContent = `
      :root { ${cssVars} }
      :root.dark { ${cssVars} }
      @media (prefers-color-scheme: dark) { :root:not(.light) { ${cssVars} } }
    `;
    document.head.appendChild(style);
  };

  // Live preview on any color change
  useEffect(() => {
    applyThemeLocally(baseColor, sidebarColor, buttonColor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseColor, sidebarColor, buttonColor]);

  const handleBrandingSave = async () => {
    if (!isAdmin) {
      setBrandError(tSettings("branding.adminOnlyUpdate"));
      return;
    }

    if (!hexColorSchema.safeParse(sidebarColor).success || !hexColorSchema.safeParse(buttonColor).success) {
      setBrandError(tSettings("branding.hexError"));
      return;
    }

    setBrandSaving(true);
    setBrandError(null);
    setBrandSuccess(null);

    const formData = new FormData();
    formData.append("baseColor", baseColor);
    formData.append("primaryColor", sidebarColor);
    formData.append("secondaryColor", buttonColor);
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
        throw new Error(data?.error || tSettings("branding.unableToSave"));
      }

      const updatedOrg = (data?.organization || null) as {
        logo_url?: string | null;
        base_color?: string | null;
        primary_color?: string | null;
        secondary_color?: string | null;
      } | null;

      const nextBase = updatedOrg?.base_color || baseColor;
      const nextSidebar = updatedOrg?.primary_color || sidebarColor;
      const nextButton = updatedOrg?.secondary_color || buttonColor;

      setLogoUrl(updatedOrg?.logo_url ?? logoUrl);
      setBaseColor(nextBase === BASE_DARK ? BASE_DARK : nextBase === BASE_WHITE ? BASE_WHITE : BASE_PRIMARY);
      setSidebarColor(nextSidebar);
      setButtonColor(nextButton);
      setBrandSuccess(tSettings("branding.saved"));
      setSelectedLogo(null);
      setLogoPreview(null);
      applyThemeLocally(nextBase, nextSidebar, nextButton);
      router.refresh();
    } catch (err) {
      setBrandError(err instanceof Error ? err.message : tSettings("branding.unableToSave"));
    } finally {
      setBrandSaving(false);
    }
  };

  const displayLogo = logoPreview || logoUrl;
  const isPrimaryBase = baseColor === BASE_PRIMARY;
  const isDarkBase = baseColor === BASE_DARK;
  // Resolve the actual background color for previews
  const resolvedBg = isPrimaryBase ? sidebarColor : isDarkBase ? BASE_DARK : "#fafbfc";
  const resolvedFg = isPrimaryBase
    ? (isColorDark(sidebarColor) ? "#ffffff" : "#000000")
    : isDarkBase ? "#ffffff" : "#000000";
  const resolvedMuted = isPrimaryBase
    ? (isColorDark(sidebarColor) ? "#a0aec0" : "#4a5568")
    : isDarkBase ? "#a0aec0" : "#4a5568";

  return (
    <Card className="org-settings-card p-5 space-y-4 opacity-0 translate-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-foreground">{tSettings("branding.title")}</p>
          <p className="text-sm text-muted-foreground">
            {tSettings("branding.description")}
          </p>
        </div>
        <Badge variant={isAdmin ? "muted" : "warning"}>{isAdmin ? tCommon("admin") : tCommon("viewOnly")}</Badge>
      </div>

      {/* Live preview showing all 3 colors */}
      <div
        className="org-brand-preview relative overflow-hidden rounded-2xl border border-border shadow-soft flex"
        style={{ backgroundColor: resolvedBg, minHeight: 88 }}
      >
        {/* Sidebar strip */}
        <div
          className="w-14 shrink-0 flex items-center justify-center"
          style={{ backgroundColor: sidebarColor }}
        >
          {displayLogo ? (
            <div className="relative h-8 w-8 rounded-lg overflow-hidden border border-white/30">
              <Image
                src={displayLogo}
                alt={orgName}
                fill
                className="object-cover"
                sizes="32px"
              />
            </div>
          ) : (
            <div className="h-8 w-8 rounded-lg flex items-center justify-center text-white/90 font-bold text-xs bg-white/20">
              {orgName.charAt(0)}
            </div>
          )}
        </div>
        {/* Content area */}
        <div className="flex-1 p-4 flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-sm" style={{ color: resolvedFg }}>
              {orgName}
            </p>
            <p className="text-xs mt-0.5" style={{ color: resolvedMuted }}>
              /{orgSlug}
            </p>
          </div>
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ backgroundColor: buttonColor, color: "#fff" }}
          >
            Button
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {/* Logo upload */}
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
            {tSettings("branding.uploadPhoto")}
          </Button>
          {selectedLogo && (
            <p className="text-sm text-muted-foreground truncate">
              {selectedLogo.name} ({Math.round(selectedLogo.size / 1024)} KB)
            </p>
          )}
        </div>

        {/* Base Color Toggle */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Base Color</p>
          <div className="flex gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => { setBaseColor(BASE_PRIMARY); setBrandSuccess(null); }}
              disabled={!isAdmin}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 transition-all duration-200 ${
                isPrimaryBase
                  ? "border-[var(--color-org-secondary)] shadow-sm"
                  : "border-border hover:border-muted-foreground"
              } ${!isAdmin ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <div className="w-6 h-6 rounded-full border border-white/30" style={{ backgroundColor: sidebarColor }} />
              <span className="text-sm font-medium text-foreground">Primary</span>
            </button>
            <button
              type="button"
              onClick={() => { setBaseColor(BASE_WHITE); setBrandSuccess(null); }}
              disabled={!isAdmin}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 transition-all duration-200 ${
                baseColor === BASE_WHITE
                  ? "border-[var(--color-org-secondary)] shadow-sm"
                  : "border-border hover:border-muted-foreground"
              } ${!isAdmin ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <div className="w-6 h-6 rounded-full border border-gray-200 bg-white" />
              <span className="text-sm font-medium text-foreground">White</span>
            </button>
            <button
              type="button"
              onClick={() => { setBaseColor(BASE_DARK); setBrandSuccess(null); }}
              disabled={!isAdmin}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 transition-all duration-200 ${
                isDarkBase
                  ? "border-[var(--color-org-secondary)] shadow-sm"
                  : "border-border hover:border-muted-foreground"
              } ${!isAdmin ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <div className="w-6 h-6 rounded-full border border-gray-600" style={{ backgroundColor: BASE_DARK }} />
              <span className="text-sm font-medium text-foreground">Dark Grey</span>
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Sets the page background and text contrast
          </p>
        </div>

        {/* Sidebar & Button Color Pickers */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Sidebar Color</p>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={sidebarColor}
                onChange={(e) => {
                  setSidebarColor(e.target.value);
                  setBrandSuccess(null);
                }}
                disabled={!isAdmin}
                className="h-11 w-16 rounded-xl border border-border cursor-pointer bg-card"
              />
              <Input
                type="text"
                value={sidebarColor}
                onChange={(e) => {
                  setSidebarColor(e.target.value);
                  setBrandSuccess(null);
                }}
                disabled={!isAdmin}
                placeholder="#1e3a5f"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Background color of the navigation sidebar
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Button Color</p>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={buttonColor}
                onChange={(e) => {
                  setButtonColor(e.target.value);
                  setBrandSuccess(null);
                }}
                disabled={!isAdmin}
                className="h-11 w-16 rounded-xl border border-border cursor-pointer bg-card"
              />
              <Input
                type="text"
                value={buttonColor}
                onChange={(e) => {
                  setButtonColor(e.target.value);
                  setBrandSuccess(null);
                }}
                disabled={!isAdmin}
                placeholder="#10b981"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Color used for buttons and active navigation items
            </p>
          </div>
        </div>
      </div>

      {brandSuccess && <div className="text-sm text-green-600 dark:text-green-400">{brandSuccess}</div>}
      {brandError && <div className="text-sm text-red-600 dark:text-red-400">{brandError}</div>}
      {!isAdmin && (
        <div className="text-sm text-muted-foreground">
          {tSettings("branding.adminOnly")}
        </div>
      )}

      <div className="flex justify-end pt-1">
        <Button onClick={handleBrandingSave} isLoading={brandSaving} disabled={!isAdmin}>
          {tSettings("branding.saveBranding")}
        </Button>
      </div>
    </Card>
  );
}
