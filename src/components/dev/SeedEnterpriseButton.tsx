"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

export function SeedEnterpriseButton() {
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  const handleSeed = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/dev/seed-enterprise", {
        method: "POST",
      });
      const data = await response.json();
      console.log("[SeedEnterpriseButton] Response:", data);

      if (!response.ok) {
        throw new Error(data.error || "Failed to seed enterprise");
      }

      // Check if RLS test returned data
      if (data.debug?.rlsTest?.length > 0) {
        setMessage("Mock enterprise created! Refreshing...");
        setTimeout(() => router.refresh(), 1000);
      } else {
        setMessage(`Created but RLS issue. Check console. Error: ${data.debug?.rlsError || "unknown"}`);
        console.error("[SeedEnterpriseButton] RLS test failed:", data.debug);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to seed");
    } finally {
      setIsLoading(false);
    }
  };

  // Only show in development
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={handleSeed}
        disabled={isLoading}
      >
        {isLoading ? "Creating..." : "Seed Mock Enterprise"}
      </Button>
      {message && (
        <span className="text-sm text-muted-foreground">{message}</span>
      )}
    </div>
  );
}
