import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { formatDefaultDateFromString } from "@/lib/date-format";
import type { AcademicSchedule, User } from "@teammeet/types";

const STALE_TIME_MS = 30_000; // 30 seconds

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type ScheduleWithUser = AcademicSchedule & {
  users: Pick<User, "name" | "email"> | null;
};

interface UseSchedulesReturn {
  mySchedules: AcademicSchedule[];
  allSchedules: ScheduleWithUser[];
  totalMembers: number;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  refetchIfStale: () => void;
}

function getOrdinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

export function formatOccurrence(schedule: AcademicSchedule): string {
  switch (schedule.occurrence_type) {
    case "single":
      return formatDefaultDateFromString(schedule.start_date);
    case "daily":
      return "Daily";
    case "weekly":
      if (schedule.day_of_week && schedule.day_of_week.length > 0) {
        const labels = schedule.day_of_week.map((day) => DAYS[day]).join(", ");
        return `Every ${labels}`;
      }
      return "Weekly";
    case "monthly":
      return schedule.day_of_month
        ? `Monthly on the ${schedule.day_of_month}${getOrdinalSuffix(schedule.day_of_month)}`
        : "Monthly";
    default:
      return schedule.occurrence_type;
  }
}

export function formatTime(time: string): string {
  const [hours, minutes] = time.split(":");
  const h = parseInt(hours, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${minutes} ${ampm}`;
}

export function useSchedules(
  orgSlug: string,
  userId: string | undefined,
  isAdmin: boolean
): UseSchedulesReturn {
  const isMountedRef = useRef(true);
  const orgIdRef = useRef<string | null>(null);
  const lastFetchTimeRef = useRef<number>(0);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [mySchedules, setMySchedules] = useState<AcademicSchedule[]>([]);
  const [allSchedules, setAllSchedules] = useState<ScheduleWithUser[]>([]);
  const [totalMembers, setTotalMembers] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset state when org changes
  useEffect(() => {
    orgIdRef.current = null;
    setOrgId(null);
    lastFetchTimeRef.current = 0;
  }, [orgSlug]);

  const fetchSchedules = useCallback(
    async (overrideOrgId?: string) => {
      if (!orgSlug || !userId) {
        if (isMountedRef.current) {
          setMySchedules([]);
          setAllSchedules([]);
          setError(null);
          setLoading(false);
          orgIdRef.current = null;
          setOrgId(null);
        }
        return;
      }

      try {
        setLoading(true);

        let resolvedOrgId = overrideOrgId ?? orgIdRef.current;

        if (!resolvedOrgId) {
          // First get org ID from slug
          const { data: org, error: orgError } = await supabase
            .from("organizations")
            .select("id")
            .eq("slug", orgSlug)
            .single();

          if (orgError) throw orgError;
          resolvedOrgId = org.id;
          orgIdRef.current = resolvedOrgId;
          if (isMountedRef.current) {
            setOrgId(resolvedOrgId);
          }
        }

        // Fetch user's own schedules
        const { data: myData, error: myError } = await supabase
          .from("academic_schedules")
          .select("*")
          .eq("organization_id", resolvedOrgId)
          .eq("user_id", userId)
          .is("deleted_at", null)
          .order("start_time", { ascending: true });

        if (myError) {
          if (myError.code === "42P01") {
            if (isMountedRef.current) {
              setMySchedules([]);
              setAllSchedules([]);
              setError(null);
            }
            return;
          }
          throw myError;
        }

        if (isMountedRef.current) {
          setMySchedules((myData as AcademicSchedule[]) || []);
        }

        // For admins, fetch all schedules with user info
        if (isAdmin) {
          const { data: allData, error: allError } = await supabase
            .from("academic_schedules")
            .select("*, users(name, email)")
            .eq("organization_id", resolvedOrgId)
            .is("deleted_at", null)
            .order("start_time", { ascending: true });

          if (allError && allError.code !== "42P01") {
            throw allError;
          }

          if (isMountedRef.current) {
            setAllSchedules((allData as ScheduleWithUser[]) || []);
          }

          // Fetch total members count
          const { count } = await supabase
            .from("user_organization_roles")
            .select("user_id", { count: "exact" })
            .eq("organization_id", resolvedOrgId)
            .eq("status", "active");

          if (isMountedRef.current) {
            setTotalMembers(count || 0);
          }
        }

        if (isMountedRef.current) {
          setError(null);
          lastFetchTimeRef.current = Date.now();
        }
      } catch (e) {
        if (isMountedRef.current) {
          const error = e as { code?: string; message: string };
          if (error.code === "42P01" || error.message?.includes("does not exist")) {
            setMySchedules([]);
            setAllSchedules([]);
            setError(null);
          } else {
            setError(error.message);
          }
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [orgSlug, userId, isAdmin]
  );

  // Initial fetch
  useEffect(() => {
    isMountedRef.current = true;
    fetchSchedules();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchSchedules]);

  // Real-time subscription for schedules table
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`schedules:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "academic_schedules",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchSchedules(orgId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchSchedules]);

  const refetchIfStale = useCallback(() => {
    const now = Date.now();
    if (now - lastFetchTimeRef.current > STALE_TIME_MS) {
      fetchSchedules();
    }
  }, [fetchSchedules]);

  return {
    mySchedules,
    allSchedules,
    totalMembers,
    loading,
    error,
    refetch: fetchSchedules,
    refetchIfStale,
  };
}
