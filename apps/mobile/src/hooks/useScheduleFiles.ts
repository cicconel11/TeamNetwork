import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { ScheduleFile, User } from "@teammeet/types";

const STALE_TIME_MS = 30_000; // 30 seconds

export type ScheduleFileWithUser = ScheduleFile & {
  users: Pick<User, "name" | "email"> | null;
};

interface UseScheduleFilesReturn {
  myFiles: ScheduleFile[];
  allFiles: ScheduleFileWithUser[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  refetchIfStale: () => void;
  uploadFile: (file: {
    uri: string;
    name: string;
    mimeType: string;
    size: number;
  }) => Promise<{ success: boolean; error?: string }>;
  deleteFile: (file: ScheduleFile) => Promise<{ success: boolean; error?: string }>;
  getSignedUrl: (filePath: string) => Promise<string | null>;
}

export function useScheduleFiles(
  orgSlug: string,
  userId: string | undefined,
  isAdmin: boolean
): UseScheduleFilesReturn {
  const isMountedRef = useRef(true);
  const orgIdRef = useRef<string | null>(null);
  const lastFetchTimeRef = useRef<number>(0);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [myFiles, setMyFiles] = useState<ScheduleFile[]>([]);
  const [allFiles, setAllFiles] = useState<ScheduleFileWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset state when org changes
  useEffect(() => {
    orgIdRef.current = null;
    setOrgId(null);
    lastFetchTimeRef.current = 0;
  }, [orgSlug]);

  const fetchFiles = useCallback(
    async (overrideOrgId?: string) => {
      if (!orgSlug || !userId) {
        if (isMountedRef.current) {
          setMyFiles([]);
          setAllFiles([]);
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

        // Fetch user's own files
        const { data: myData, error: myError } = await supabase
          .from("schedule_files")
          .select("*")
          .eq("organization_id", resolvedOrgId)
          .eq("user_id", userId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false });

        if (myError) {
          if (myError.code === "42P01") {
            if (isMountedRef.current) {
              setMyFiles([]);
              setAllFiles([]);
              setError(null);
            }
            return;
          }
          throw myError;
        }

        if (isMountedRef.current) {
          setMyFiles((myData as ScheduleFile[]) || []);
        }

        // For admins, fetch all files with user info
        if (isAdmin) {
          const { data: allData, error: allError } = await supabase
            .from("schedule_files")
            .select("*, users(name, email)")
            .eq("organization_id", resolvedOrgId)
            .is("deleted_at", null)
            .order("created_at", { ascending: false });

          if (allError && allError.code !== "42P01") {
            throw allError;
          }

          if (isMountedRef.current) {
            setAllFiles((allData as ScheduleFileWithUser[]) || []);
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
            setMyFiles([]);
            setAllFiles([]);
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
    fetchFiles();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchFiles]);

  // Real-time subscription for schedule_files table
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`schedule-files:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "schedule_files",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchFiles(orgId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchFiles]);

  const refetchIfStale = useCallback(() => {
    const now = Date.now();
    if (now - lastFetchTimeRef.current > STALE_TIME_MS) {
      fetchFiles();
    }
  }, [fetchFiles]);

  const uploadFile = useCallback(
    async (file: {
      uri: string;
      name: string;
      mimeType: string;
      size: number;
    }): Promise<{ success: boolean; error?: string }> => {
      if (!orgId || !userId) {
        return { success: false, error: "Not authenticated" };
      }

      // Validate file type
      const allowedTypes = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
      if (!allowedTypes.includes(file.mimeType)) {
        return { success: false, error: "Please upload a PDF or image file" };
      }

      // Validate file size (10MB max)
      if (file.size > 10 * 1024 * 1024) {
        return { success: false, error: "File size must be under 10MB" };
      }

      try {
        // Fetch the file as blob
        const response = await fetch(file.uri);
        const blob = await response.blob();

        // Upload to storage: {user_id}/{timestamp}_{filename}
        const timestamp = Date.now();
        const filePath = `${userId}/${timestamp}_${file.name}`;

        const { error: uploadError } = await supabase.storage
          .from("schedule-files")
          .upload(filePath, blob, {
            contentType: file.mimeType,
          });

        if (uploadError) {
          return { success: false, error: uploadError.message };
        }

        // Record in database
        const { error: dbError } = await supabase.from("schedule_files").insert({
          organization_id: orgId,
          user_id: userId,
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          mime_type: file.mimeType,
        });

        if (dbError) {
          return { success: false, error: dbError.message };
        }

        // Refetch files
        await fetchFiles(orgId);

        return { success: true };
      } catch (e) {
        const error = e as Error;
        return { success: false, error: error.message };
      }
    },
    [orgId, userId, fetchFiles]
  );

  const deleteFile = useCallback(
    async (file: ScheduleFile): Promise<{ success: boolean; error?: string }> => {
      try {
        // Delete from storage first
        const { error: storageError } = await supabase.storage
          .from("schedule-files")
          .remove([file.file_path]);

        if (storageError) {
          console.error("Storage delete error:", storageError);
          // Continue with DB delete even if storage fails
        }

        // Hard delete from DB
        const { error: dbError } = await supabase
          .from("schedule_files")
          .delete()
          .eq("id", file.id);

        if (dbError) {
          return { success: false, error: dbError.message };
        }

        // Refetch files
        if (orgId) {
          await fetchFiles(orgId);
        }

        return { success: true };
      } catch (e) {
        const error = e as Error;
        return { success: false, error: error.message };
      }
    },
    [orgId, fetchFiles]
  );

  const getSignedUrl = useCallback(async (filePath: string): Promise<string | null> => {
    const { data, error } = await supabase.storage
      .from("schedule-files")
      .createSignedUrl(filePath, 60 * 5); // 5 min expiry

    if (error || !data?.signedUrl) {
      return null;
    }

    return data.signedUrl;
  }, []);

  return {
    myFiles,
    allFiles,
    loading,
    error,
    refetch: fetchFiles,
    refetchIfStale,
    uploadFile,
    deleteFile,
    getSignedUrl,
  };
}
