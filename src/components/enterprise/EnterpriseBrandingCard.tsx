"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { animate } from "animejs";
import { Badge, Button, Card, Input } from "@/components/ui";
import { hexColorSchema } from "@/lib/schemas/common";

interface EnterpriseBrandingCardProps {
  enterpriseId: string;
  enterpriseName: string;
  enterpriseSlug: string;
  isAdmin: boolean;
  initialLogoUrl: string | null;
  initialPrimaryColor: string;
}

export function EnterpriseBrandingCard({
  enterpriseId,
  enterpriseName,
  enterpriseSlug,
  isAdmin,
  initialLogoUrl,
  initialPrimaryColor,
}: EnterpriseBrandingCardProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [primaryColor, setPrimaryColor] = useState(initialPrimaryColor);
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

  // Brand preview animation
  useEffect(() => {
    animate(".enterprise-brand-preview", {
      scale: [0.98, 1],
      opacity: [0.9, 1],
      duration: 480,
      easing: "easeOutQuad",
    });
  }, [primaryColor, logoPreview, logoUrl]);

  const handleBrandingSave = async () => {
    if (!isAdmin) {
      setBrandError("Only enterprise admins can update branding.");
      return;
    }

    if (!hexColorSchema.safeParse(primaryColor).success) {
      setBrandError("Brand color must be a valid 6-digit hex value (e.g., #6B21A8).");
      return;
    }

    setBrandSaving(true);
    setBrandError(null);
    setBrandSuccess(null);

    const formData = new FormData();
    formData.append("primaryColor", primaryColor);
    if (selectedLogo) {
      formData.append("logo", selectedLogo);
    }

    try {
      const res = await fetch(`/api/enterprise/${enterpriseId}/branding`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || "Unable to save branding.");
      }

      const updatedEnterprise = (data?.enterprise || null) as {
        logo_url?: string | null;
        primary_color?: string | null;
      } | null;

      setLogoUrl(updatedEnterprise?.logo_url ?? logoUrl);
      setPrimaryColor(updatedEnterprise?.primary_color || primaryColor);
      setBrandSuccess("Branding saved successfully.");
      setSelectedLogo(null);
      setLogoPreview(null);
      router.refresh();
    } catch (err) {
      setBrandError(err instanceof Error ? err.message : "Unable to save branding.");
    } finally {
      setBrandSaving(false);
    }
  };

  const displayLogo = logoPreview || logoUrl;

  return (
    <Card className="p-5 space-y-4 mb-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-foreground">Branding</p>
          <p className="text-sm text-muted-foreground">
            Upload a logo and set your brand color
          </p>
        </div>
        <Badge variant={isAdmin ? "muted" : "warning"}>
          {isAdmin ? "Owner" : "View Only"}
        </Badge>
      </div>

      {/* Preview */}
      <div
        className="enterprise-brand-preview relative overflow-hidden rounded-2xl border border-border p-5 shadow-soft"
        style={{ backgroundColor: primaryColor }}
      >
        <div className="absolute inset-0 bg-black/5 dark:bg-black/20" />
        <div className="relative flex items-center gap-4">
          {displayLogo ? (
            <div className="relative h-14 w-14 rounded-2xl overflow-hidden border border-white/40 shadow-lg">
              <Image
                src={displayLogo}
                alt={enterpriseName}
                fill
                className="object-cover"
                sizes="56px"
              />
            </div>
          ) : (
            <div className="h-14 w-14 rounded-2xl flex items-center justify-center text-white font-bold text-lg bg-white/20 shadow-lg">
              {enterpriseName.charAt(0)}
            </div>
          )}
          <div>
            <p className="font-semibold text-white">{enterpriseName}</p>
            <p className="text-sm text-white/80 truncate">/enterprise/{enterpriseSlug}</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {/* Logo Upload */}
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
            Upload Logo
          </Button>
          {selectedLogo && (
            <p className="text-sm text-muted-foreground truncate">
              {selectedLogo.name} ({Math.round(selectedLogo.size / 1024)} KB)
            </p>
          )}
        </div>

        {/* Brand Color */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Brand Color</p>
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
              placeholder="#6B21A8"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Used for headers, buttons, and brand accents
          </p>
        </div>
      </div>

      {brandSuccess && <div className="text-sm text-green-600 dark:text-green-400">{brandSuccess}</div>}
      {brandError && <div className="text-sm text-red-600 dark:text-red-400">{brandError}</div>}
      {!isAdmin && (
        <div className="text-sm text-muted-foreground">
          Only enterprise admins can update branding settings.
        </div>
      )}

      <div className="flex justify-end pt-1">
        <Button onClick={handleBrandingSave} isLoading={brandSaving} disabled={!isAdmin}>
          Save Branding
        </Button>
      </div>
    </Card>
  );
}
