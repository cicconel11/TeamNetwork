import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { fetchWithAuth } from "@/lib/web-api";
import type { OrgRole } from "@teammeet/core";

export interface NavConfigEntry {
  label?: string;
  hidden?: boolean;
  hiddenForRoles?: OrgRole[];
  editRoles?: OrgRole[];
  order?: number;
}

export type NavConfig = Record<string, NavConfigEntry>;

interface UseNavConfigReturn {
  navConfig: NavConfig;
  orgId: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  saveNavConfig: (config: NavConfig) => Promise<{ success: boolean; error?: string }>;
  refetch: () => void;
}

export function useNavConfig(orgSlug: string | null): UseNavConfigReturn {
  const isMountedRef = useRef(true);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [navConfig, setNavConfig] = useState<NavConfig>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNavConfig = useCallback(async () => {
    if (!orgSlug) {
      setNavConfig({});
      setOrgId(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("organizations")
        .select("id, nav_config")
        .eq("slug", orgSlug)
        .single();

      if (fetchError) throw fetchError;

      if (isMountedRef.current) {
        setOrgId(data.id);
        // Parse nav_config - it could be null or an object
        const rawConfig = data.nav_config;
        let config: NavConfig = {};
        if (rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)) {
          config = rawConfig as NavConfig;
        }
        setNavConfig(config);
        setError(null);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setError((e as Error).message);
        setNavConfig({});
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [orgSlug]);

  // Initial fetch
  useEffect(() => {
    isMountedRef.current = true;
    fetchNavConfig();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchNavConfig]);

  // Real-time subscription for nav_config changes
  useEffect(() => {
    if (!orgId) return;

    const channel = supabase
      .channel(`nav-config:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "organizations",
          filter: `id=eq.${orgId}`,
        },
        () => {
          // Refetch when organization is updated (could be nav_config change from web)
          fetchNavConfig();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchNavConfig]);

  const saveNavConfig = useCallback(
    async (config: NavConfig): Promise<{ success: boolean; error?: string }> => {
      if (!orgId) {
        return { success: false, error: "Organization not loaded" };
      }

      try {
        setSaving(true);

        const response = await fetchWithAuth(`/api/organizations/${orgId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ navConfig: config }),
        });

        const data = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(data?.error || "Unable to save navigation settings");
        }

        // Update local state with the sanitized config from server
        if (isMountedRef.current && data?.navConfig) {
          setNavConfig(data.navConfig);
        } else if (isMountedRef.current) {
          // Fallback: use the config we sent
          setNavConfig(config);
        }

        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      } finally {
        if (isMountedRef.current) {
          setSaving(false);
        }
      }
    },
    [orgId]
  );

  return {
    navConfig,
    orgId,
    loading,
    saving,
    error,
    saveNavConfig,
    refetch: fetchNavConfig,
  };
}
