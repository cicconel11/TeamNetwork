"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { animate } from "animejs";
import { Badge, Button, Card, Input } from "@/components/ui";
import { computeOrgThemeVariables } from "@/lib/theming/org-colors";
import { hexColorSchema } from "@/lib/schemas/common";

interface BrandingCardProps {
  orgId: string;
  orgSlug: string;
  orgName: string;
  isAdmin: boolean;
  initialLogoUrl: string | null;
  initialPrimaryColor: string;
  initialSecondaryColor: string;
}

export function BrandingCard({
  orgId,
  orgSlug,
  orgName,
  isAdmin,
  initialLogoUrl,
  initialPrimaryColor,
  initialSecondaryColor,
}: BrandingCardProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [primaryColor, setPrimaryColor] = useState(initialPrimaryColor);
  const [secondaryColor, setSecondaryColor] = useState(initialSecondaryColor);
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
  }, [primaryColor, secondaryColor, logoPreview, logoUrl]);

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

  const handleBrandingSave = async () => {
    if (!isAdmin) {
      setBrandError("Only admins can update branding.");
      return;
    }

    if (!hexColorSchema.safeParse(primaryColor).success || !hexColorSchema.safeParse(secondaryColor).success) {
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

  return (
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
        style={{ backgroundColor: primaryColor }}
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
  );
}
