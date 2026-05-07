import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { fetchWithAuth } from "@/lib/web-api";
import * as sentry from "@/lib/analytics/sentry";

export interface OrgSettings {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  timezone: string;
  default_language: string;
  feed_post_roles: string[];
  discussion_post_roles: string[];
  job_post_roles: string[];
  media_upload_roles: string[];
  linkedin_resync_enabled: boolean;
}

interface UseOrgSettingsReturn {
  org: OrgSettings | null;
  loading: boolean;
  error: string | null;
  updateName: (name: string) => Promise<{ success: boolean; error?: string }>;
  updateBranding: (data: {
    primaryColor?: string;
    secondaryColor?: string;
    logo?: { uri: string; name: string; type: string };
  }) => Promise<{ success: boolean; error?: string }>;
  updateSettings: (fields: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  refetch: () => Promise<void>;
}

export function useOrgSettings(orgId: string | null): UseOrgSettingsReturn {
  const isMountedRef = useRef(true);
  const [org, setOrg] = useState<OrgSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrg = useCallback(async () => {
    if (!orgId) {
      setOrg(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("organizations")
        .select("id, name, slug, logo_url, primary_color, secondary_color, timezone, default_language, feed_post_roles, discussion_post_roles, job_post_roles, media_upload_roles, linkedin_resync_enabled")
        .eq("id", orgId)
        .single();

      if (fetchError) throw fetchError;

      if (isMountedRef.current) {
        setOrg(data);
        setError(null);
      }
    } catch (e) {
      sentry.captureException(e as Error, { context: "useOrgSettings.fetchOrg" });
      if (isMountedRef.current) {
        setError((e as Error).message);
        setOrg(null);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [orgId]);

  // Initial fetch
  useEffect(() => {
    isMountedRef.current = true;
    fetchOrg();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchOrg]);

  // Realtime subscription
  useEffect(() => {
    if (!org?.id) return;

    const channel = supabase
      .channel(`org-settings:${org.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "organizations",
          filter: `id=eq.${org.id}`,
        },
        () => {
          fetchOrg();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [org?.id, fetchOrg]);

  const updateName = useCallback(
    async (name: string): Promise<{ success: boolean; error?: string }> => {
      if (!org?.id) {
        return { success: false, error: "Organization not loaded" };
      }

      try {
        const response = await fetchWithAuth(`/api/organizations/${org.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        });

        const data = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(data?.error || "Unable to update organization name");
        }

        // Optimistically update local state
        if (isMountedRef.current && data?.name) {
          setOrg((prev) => (prev ? { ...prev, name: data.name } : prev));
        }

        return { success: true };
      } catch (e) {
        sentry.captureException(e as Error, { context: "useOrgSettings.updateName" });
        return { success: false, error: (e as Error).message };
      }
    },
    [org?.id]
  );

  const updateBranding = useCallback(
    async (data: {
      primaryColor?: string;
      secondaryColor?: string;
      logo?: { uri: string; name: string; type: string };
    }): Promise<{ success: boolean; error?: string }> => {
      if (!org?.id) {
        return { success: false, error: "Organization not loaded" };
      }

      try {
        const formData = new FormData();

        if (data.primaryColor) {
          formData.append("primaryColor", data.primaryColor);
        }
        if (data.secondaryColor) {
          formData.append("secondaryColor", data.secondaryColor);
        }
        if (data.logo) {
          // React Native FormData accepts file-like objects cast as Blob
          formData.append("logo", { uri: data.logo.uri, name: data.logo.name, type: data.logo.type } as unknown as Blob);
        }

        const response = await fetchWithAuth(
          `/api/organizations/${org.id}/branding`,
          {
            method: "POST",
            body: formData,
          }
        );

        const responseData = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(responseData?.error || "Unable to update branding");
        }

        // Optimistically update local state
        if (isMountedRef.current && responseData?.organization) {
          const updated = responseData.organization;
          setOrg((prev) =>
            prev
              ? {
                  ...prev,
                  logo_url: updated.logo_url ?? prev.logo_url,
                  primary_color: updated.primary_color ?? prev.primary_color,
                  secondary_color:
                    updated.secondary_color ?? prev.secondary_color,
                }
              : prev
          );
        }

        return { success: true };
      } catch (e) {
        sentry.captureException(e as Error, { context: "useOrgSettings.updateBranding" });
        return { success: false, error: (e as Error).message };
      }
    },
    [org?.id]
  );

  const updateSettings = useCallback(
    async (fields: Record<string, unknown>): Promise<{ success: boolean; error?: string }> => {
      if (!org?.id) {
        return { success: false, error: "Organization not loaded" };
      }

      try {
        const response = await fetchWithAuth(`/api/organizations/${org.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fields),
        });

        const data = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(data?.error || "Unable to update settings");
        }

        // Optimistically merge returned fields into state
        if (isMountedRef.current && data) {
          setOrg((prev) => (prev ? { ...prev, ...data } : prev));
        }

        return { success: true };
      } catch (e) {
        sentry.captureException(e as Error, { context: "useOrgSettings.updateSettings" });
        return { success: false, error: (e as Error).message };
      }
    },
    [org?.id]
  );

  return { org, loading, error, updateName, updateBranding, updateSettings, refetch: fetchOrg };
}
