"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { claimAlumniProfile } from "@/lib/auth/claim-flow";

interface ClaimAlumniBannerProps {
  /**
   * Computed SERVER-SIDE on the detail page: alumni.user_id IS NULL and the
   * authed viewer's verified email matches the alumni email
   * (case-insensitively). The banner is pure UX — the claim_alumni_profiles
   * RPC re-derives identity from auth.uid() and re-validates server-side.
   */
  visible: boolean;
}

export function ClaimAlumniBanner({ visible }: ClaimAlumniBannerProps) {
  const router = useRouter();
  const [isClaiming, setIsClaiming] = useState(false);

  if (!visible) {
    return null;
  }

  const handleClaim = async () => {
    setIsClaiming(true);
    try {
      await claimAlumniProfile();
      toast.success("Profile claimed");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to claim alumni profile");
    } finally {
      setIsClaiming(false);
    }
  };

  return (
    <div
      data-testid="claim-alumni-banner"
      className="mb-6 flex flex-col gap-3 rounded-xl border border-[var(--color-org-primary)]/30 bg-[var(--color-org-primary)]/5 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <p className="text-sm font-semibold text-foreground">This looks like your profile</p>
        <p className="text-sm text-muted-foreground mt-0.5">
          Claim it to keep your info up to date.
        </p>
      </div>
      <Button
        variant="primary"
        onClick={handleClaim}
        isLoading={isClaiming}
        data-testid="claim-alumni-button"
        className="shrink-0"
      >
        Claim profile
      </Button>
    </div>
  );
}
