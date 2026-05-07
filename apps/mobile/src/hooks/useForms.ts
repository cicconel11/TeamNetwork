import { useEffect, useState, useRef, useCallback } from "react";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useRequestTracker } from "@/hooks/useRequestTracker";
import { showToast } from "@/components/ui/Toast";
import * as sentry from "@/lib/analytics/sentry";
import type { Form, FormDocument } from "@teammeet/types";

const STALE_TIME_MS = 30_000; // 30 seconds

interface UseFormsReturn {
  forms: Form[];
  formDocuments: FormDocument[];
  submittedFormIds: Set<string>;
  submittedDocIds: Set<string>;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  refetchIfStale: () => void;
}

export function useForms(orgId: string | null): UseFormsReturn {
  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(0);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { beginRequest, invalidateRequests, isCurrentRequest } = useRequestTracker();
  const [forms, setForms] = useState<Form[]>([]);
  const [formDocuments, setFormDocuments] = useState<FormDocument[]>([]);
  const [submittedFormIds, setSubmittedFormIds] = useState<Set<string>>(new Set());
  const [submittedDocIds, setSubmittedDocIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset when org or user changes
  useEffect(() => {
    lastFetchTimeRef.current = 0;
    invalidateRequests();
  }, [orgId, userId, invalidateRequests]);

  const fetchForms = useCallback(async () => {
    const requestId = beginRequest();

    if (!orgId || !userId) {
      if (isMountedRef.current) {
        setForms([]);
        setFormDocuments([]);
        setSubmittedFormIds(new Set());
        setSubmittedDocIds(new Set());
        setError(null);
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);

      // Fetch active forms
      const { data: formsData, error: formsError } = await supabase
        .from("forms")
        .select("*")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (formsError) {
        // If table doesn't exist, return empty
        if (formsError.code === "42P01") {
          if (isMountedRef.current) {
            setForms([]);
            setFormDocuments([]);
            setSubmittedFormIds(new Set());
            setSubmittedDocIds(new Set());
            setError(null);
          }
          return;
        }
        throw formsError;
      }

      // Fetch active document forms
      const { data: docsData, error: docsError } = await supabase
        .from("form_documents")
        .select("*")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (docsError && docsError.code !== "42P01") {
        throw docsError;
      }

      // Fetch user's form submissions
      const { data: submissions } = await supabase
        .from("form_submissions")
        .select("form_id")
        .eq("organization_id", orgId)
        .eq("user_id", userId);

      // Fetch user's document submissions
      const { data: docSubmissions } = await supabase
        .from("form_document_submissions")
        .select("document_id")
        .eq("organization_id", orgId)
        .eq("user_id", userId);

      if (isMountedRef.current && isCurrentRequest(requestId)) {
        setForms((formsData as Form[]) || []);
        setFormDocuments((docsData as FormDocument[]) || []);
        setSubmittedFormIds(new Set(submissions?.map((s) => s.form_id) || []));
        setSubmittedDocIds(new Set(docSubmissions?.map((s) => s.document_id) || []));
        setError(null);
        lastFetchTimeRef.current = Date.now();
      }
    } catch (e) {
      if (isMountedRef.current && isCurrentRequest(requestId)) {
        const error = e as { code?: string; message: string };
        if (error.code === "42P01" || error.message?.includes("does not exist")) {
          setForms([]);
          setFormDocuments([]);
          setSubmittedFormIds(new Set());
          setSubmittedDocIds(new Set());
          setError(null);
        } else {
          const message = error.message || "An error occurred";
            setError(message);
            showToast(message, "error");
            sentry.captureException(e as Error, {
              context: "useForms",
              orgId,
            });
          }
        }
      } finally {
      if (isMountedRef.current && isCurrentRequest(requestId)) {
        setLoading(false);
      }
    }
  }, [orgId, userId, beginRequest, isCurrentRequest]);

  // Initial fetch
  useEffect(() => {
    isMountedRef.current = true;
    fetchForms();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchForms]);

  // Real-time subscriptions
  useEffect(() => {
    if (!orgId) return;

    const channel = createPostgresChangesChannel(`forms:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "forms",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchForms();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "form_documents",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchForms();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "form_submissions",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchForms();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "form_document_submissions",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchForms();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchForms]);

  const refetchIfStale = useCallback(() => {
    const now = Date.now();
    if (now - lastFetchTimeRef.current > STALE_TIME_MS) {
      fetchForms();
    }
  }, [fetchForms]);

  return {
    forms,
    formDocuments,
    submittedFormIds,
    submittedDocIds,
    loading,
    error,
    refetch: fetchForms,
    refetchIfStale,
  };
}
