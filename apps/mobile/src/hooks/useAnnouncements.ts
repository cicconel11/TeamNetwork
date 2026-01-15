import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { filterAnnouncementsForUser, ViewerContext } from "@teammeet/core";
import { normalizeRole } from "@teammeet/core";
import type { Announcement } from "@teammeet/types";

interface UseAnnouncementsReturn {
  announcements: Announcement[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useAnnouncements(orgSlug: string): UseAnnouncementsReturn {
  const isMountedRef = useRef(true);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnnouncements = async () => {
    if (!orgSlug) {
      if (isMountedRef.current) {
        setAnnouncements([]);
        setError(null);
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);

      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Get org ID from slug
      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .single();

      if (orgError) throw orgError;

      // Get user's role in this org
      const { data: roleData } = await supabase
        .from("user_organization_roles")
        .select("role, status")
        .eq("organization_id", org.id)
        .eq("user_id", user.id)
        .eq("status", "active")
        .single();

      // Fetch announcements
      const { data: announcementsData, error: announcementsError } = await supabase
        .from("announcements")
        .select("*")
        .eq("organization_id", org.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (announcementsError) throw announcementsError;

      // Filter based on audience targeting
      const ctx: ViewerContext = {
        role: normalizeRole(roleData?.role),
        status: roleData?.status ?? null,
        userId: user.id,
      };

      const filtered = filterAnnouncementsForUser(announcementsData, ctx);

      if (isMountedRef.current) {
        setAnnouncements(filtered);
        setError(null);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setError((e as Error).message);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    fetchAnnouncements();

    return () => {
      isMountedRef.current = false;
    };
  }, [orgSlug]);

  return { announcements, loading, error, refetch: fetchAnnouncements };
}
