import { useEffect, useState, useRef, useCallback } from "react";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import { showToast } from "@/components/ui/Toast";
import * as sentry from "@/lib/analytics/sentry";
import type {
  JobPostingWithPoster,
  JobFilters,
  CreateJobInput,
  UseJobsReturn,
} from "@/types/jobs";

const STALE_TIME_MS = 30_000; // 30 seconds

/**
 * Hook to fetch job postings for an organization with CRUD and realtime support.
 * @param orgId - The organization ID (from useOrg context)
 * @param filters - Optional filters for query, location_type, experience_level
 */
export function useJobs(
  orgId: string | null,
  filters?: JobFilters,
  options?: { realtime?: boolean }
): UseJobsReturn {
  const realtimeEnabled = options?.realtime ?? true;
  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(0);

  const [jobs, setJobs] = useState<JobPostingWithPoster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canPost, setCanPost] = useState(false);

  const fetchCanPost = useCallback(async () => {
    if (!orgId) return;

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: roleRow, error: roleError } = await supabase
        .from("user_organization_roles")
        .select("role")
        .eq("organization_id", orgId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (roleError || !roleRow) return;

      const { data: orgRow, error: orgError } = await supabase
        .from("organizations")
        .select("job_post_roles")
        .eq("id", orgId)
        .maybeSingle();

      if (orgError || !orgRow) return;

      const jobPostRoles = (orgRow.job_post_roles as string[] | null) ?? [];
      if (isMountedRef.current) {
        setCanPost(jobPostRoles.includes(roleRow.role));
      }
    } catch (e) {
      sentry.captureException(e as Error, {
        context: "useJobs.fetchCanPost",
        orgId,
      });
    }
  }, [orgId]);

  const fetchJobs = useCallback(async () => {
    if (!orgId) {
      if (isMountedRef.current) {
        setJobs([]);
        setError(null);
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);

      let query = supabase
        .from("job_postings")
        .select("*, poster:users!job_postings_posted_by_fkey(id, name, avatar_url)", {
          count: "exact",
        })
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .eq("is_active", true)
        .or("expires_at.is.null,expires_at.gt.now()")
        .order("created_at", { ascending: false });

      if (filters?.query) {
        const q = filters.query;
        query = query.or(`title.ilike.%${q}%,company.ilike.%${q}%`);
      }

      if (filters?.location_type) {
        query = query.eq("location_type", filters.location_type);
      }

      if (filters?.experience_level) {
        query = query.eq("experience_level", filters.experience_level);
      }

      const { data, error: jobsError } = await query;

      if (jobsError) {
        // If job_postings table doesn't exist, return empty array
        if (jobsError.code === "42P01") {
          if (isMountedRef.current) {
            setJobs([]);
            setError(null);
          }
          return;
        }
        throw jobsError;
      }

      if (isMountedRef.current) {
        setJobs((data as JobPostingWithPoster[]) ?? []);
        setError(null);
        lastFetchTimeRef.current = Date.now();
      }
    } catch (e) {
      if (isMountedRef.current) {
        const err = e as { code?: string; message: string };
        if (err.code === "42P01" || err.message?.includes("does not exist")) {
          setJobs([]);
          setError(null);
        } else {
          const message = err.message || "An error occurred";
          setError(message);
          showToast(message, "error");
          sentry.captureException(e as Error, {
            context: "useJobs",
            orgId,
          });
        }
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [orgId, filters?.query, filters?.location_type, filters?.experience_level]);

  const refetch = useCallback(async () => {
    await fetchJobs();
  }, [fetchJobs]);

  const refetchIfStale = useCallback(() => {
    const now = Date.now();
    if (now - lastFetchTimeRef.current > STALE_TIME_MS) {
      fetchJobs();
    }
  }, [fetchJobs]);

  const createJob = useCallback(
    async (input: CreateJobInput): Promise<void> => {
      if (!orgId) throw new Error("No organization selected");

      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();
        if (userError || !user) throw new Error("Not authenticated");

        const { error: insertError } = await supabase
          .from("job_postings")
          .insert({
            ...input,
            organization_id: orgId,
            posted_by: user.id,
          });

        if (insertError) throw insertError;

        await fetchJobs();
      } catch (e) {
        const message = (e as Error).message || "Failed to create job posting";
        showToast(message, "error");
        sentry.captureException(e as Error, {
          context: "useJobs.createJob",
          orgId,
        });
        throw e;
      }
    },
    [orgId, fetchJobs]
  );

  const updateJob = useCallback(
    async (jobId: string, input: Partial<CreateJobInput>): Promise<void> => {
      try {
        const { error: updateError } = await supabase
          .from("job_postings")
          .update({ ...input, updated_at: new Date().toISOString() })
          .eq("id", jobId);

        if (updateError) throw updateError;

        await fetchJobs();
      } catch (e) {
        const message = (e as Error).message || "Failed to update job posting";
        showToast(message, "error");
        sentry.captureException(e as Error, {
          context: "useJobs.updateJob",
          jobId,
        });
        throw e;
      }
    },
    [fetchJobs]
  );

  const deleteJob = useCallback(
    async (jobId: string): Promise<void> => {
      try {
        const { error: deleteError } = await supabase
          .from("job_postings")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", jobId);

        if (deleteError) throw deleteError;

        await fetchJobs();
      } catch (e) {
        const message = (e as Error).message || "Failed to delete job posting";
        showToast(message, "error");
        sentry.captureException(e as Error, {
          context: "useJobs.deleteJob",
          jobId,
        });
        throw e;
      }
    },
    [fetchJobs]
  );

  useEffect(() => {
    isMountedRef.current = true;
    fetchJobs();
    fetchCanPost();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchJobs, fetchCanPost]);

  // Realtime subscription for job_postings changes
  useEffect(() => {
    if (!orgId || !realtimeEnabled) return;

    const channel = createPostgresChangesChannel(`job_postings:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "job_postings",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchJobs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchJobs, realtimeEnabled]);

  return {
    jobs,
    loading,
    error,
    canPost,
    refetch,
    refetchIfStale,
    createJob,
    updateJob,
    deleteJob,
  };
}
