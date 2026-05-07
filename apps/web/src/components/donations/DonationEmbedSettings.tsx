"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input } from "@/components/ui";

interface DonationEmbedSettingsProps {
  orgId: string;
  orgSlug: string;
  currentUrl: string | null;
}

export function DonationEmbedSettings({ orgId, orgSlug, currentUrl }: DonationEmbedSettingsProps) {
  const [url, setUrl] = useState(currentUrl || "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    const trimmed = url.trim();
    if (trimmed) {
      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== "https:") {
          throw new Error("URL must start with https://");
        }
      } catch {
        setError("Please enter a valid https:// URL");
        setIsSaving(false);
        return;
      }
    }

    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("organizations")
      .update({ donation_embed_url: trimmed || null })
      .eq("id", orgId);

    if (updateError) {
      setError(updateError.message);
      setIsSaving(false);
      return;
    }

    window.location.href = `/${orgSlug}/donations`;
  };

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-foreground">Donation embed (admin)</h3>
        <p className="text-sm text-muted-foreground">
          Link to an external donation page to display inside the portal.
        </p>
      </div>
      {error && (
        <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}
      <Input
        label="Embed URL"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://donations.example.com"
      />
      <div className="flex justify-end">
        <Button onClick={handleSave} isLoading={isSaving}>
          Save embed
        </Button>
      </div>
    </Card>
  );
}

