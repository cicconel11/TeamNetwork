"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { EnterpriseNavEditor } from "@/components/enterprise/EnterpriseNavEditor";
import type { NavConfig } from "@/lib/navigation/nav-items";

interface Organization {
  id: string;
  name: string;
  slug: string;
  enterprise_nav_synced_at: string | null;
}

interface NavigationData {
  navConfig: NavConfig;
  lockedItems: string[];
  organizations: Organization[];
}

interface NavigationClientProps {
  enterpriseId: string;
}

export function NavigationClient({ enterpriseId }: NavigationClientProps) {
  const [data, setData] = useState<NavigationData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/enterprise/${enterpriseId}/navigation`);
      if (res.ok) {
        const navData = await res.json();
        setData(navData);
      } else {
        setError("Failed to load navigation settings");
      }
    } catch {
      setError("Failed to load navigation settings");
    }
  }, [enterpriseId]);

  useEffect(() => {
    fetchData().finally(() => setIsLoading(false));
  }, [fetchData]);

  const handleSave = async (navConfig: NavConfig, lockedItems: string[]) => {
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const res = await fetch(`/api/enterprise/${enterpriseId}/navigation`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ navConfig, lockedItems }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);

      await fetchData();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    }
  };

  const handleSync = async () => {
    try {
      const res = await fetch(`/api/enterprise/${enterpriseId}/navigation/sync`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to sync");
      }

      await fetchData();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to sync");
    }
  };

  if (isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Navigation Control" description="Loading..." />
        <Card className="p-8">
          <div className="flex items-center justify-center">
            <LoadingSpinner className="h-8 w-8 text-purple-600" />
          </div>
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Navigation Control" />
        <Card className="p-8 text-center">
          <p className="text-red-600">{error || "Failed to load data"}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Navigation Control"
        description="Configure sidebar navigation across all sub-organizations"
      />

      {saveError && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {saveError}
        </div>
      )}

      {saveSuccess && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 text-sm">
          Navigation settings saved successfully.
        </div>
      )}

      <EnterpriseNavEditor
          enterpriseId={enterpriseId}
          initialNavConfig={data.navConfig}
          initialLockedItems={data.lockedItems}
          organizations={data.organizations}
          onSave={handleSave}
          onSync={handleSync}
        />
    </div>
  );
}

function LoadingSpinner({ className }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
