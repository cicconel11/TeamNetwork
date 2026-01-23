import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
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

export function useForms(orgSlug: string): UseFormsReturn {
  const isMountedRef = useRef(true);
  const orgIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const lastFetchTimeRef = useRef<number>(0);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [forms, setForms] = useState<Form[]>([]);
  const [formDocuments, setFormDocuments] = useState<FormDocument[]>([]);
  const [submittedFormIds, setSubmittedFormIds] = useState<Set<string>>(new Set());
  const [submittedDocIds, setSubmittedDocIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset when org changes
  useEffect(() => {
    orgIdRef.current = null;
    userIdRef.current = null;
    setOrgId(null);
    lastFetchTimeRef.current = 0;
  }, [orgSlug]);

  const fetchForms = useCallback(async (overrideOrgId?: string) => {
    if (!orgSlug) {
      if (isMountedRef.current) {
        setForms([]);
        setFormDocuments([]);
        setSubmittedFormIds(new Set());
        setSubmittedDocIds(new Set());
        setError(null);
        setLoading(false);
        orgIdRef.current = null;
        setOrgId(null);
      }
      return;
    }

    try {
      setLoading(true);

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      userIdRef.current = user.id;

      let resolvedOrgId = overrideOrgId ?? orgIdRef.current;

      if (!resolvedOrgId) {
        // Get org ID from slug
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

      // Fetch active forms
      const { data: formsData, error: formsError } = await supabase
        .from("forms")
        .select("*")
        .eq("organization_id", resolvedOrgId)
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
        .eq("organization_id", resolvedOrgId)
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
        .eq("organization_id", resolvedOrgId)
        .eq("user_id", user.id);

      // Fetch user's document submissions
      const { data: docSubmissions } = await supabase
        .from("form_document_submissions")
        .select("document_id")
        .eq("organization_id", resolvedOrgId)
        .eq("user_id", user.id);

      if (isMountedRef.current) {
        setForms((formsData as Form[]) || []);
        setFormDocuments((docsData as FormDocument[]) || []);
        setSubmittedFormIds(new Set(submissions?.map((s) => s.form_id) || []));
        setSubmittedDocIds(new Set(docSubmissions?.map((s) => s.document_id) || []));
        setError(null);
        lastFetchTimeRef.current = Date.now();
      }
    } catch (e) {
      if (isMountedRef.current) {
        const error = e as { code?: string; message: string };
        if (error.code === "42P01" || error.message?.includes("does not exist")) {
          setForms([]);
          setFormDocuments([]);
          setSubmittedFormIds(new Set());
          setSubmittedDocIds(new Set());
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
  }, [orgSlug]);

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

    const channel = supabase
      .channel(`forms:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "forms",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchForms(orgId);
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
          fetchForms(orgId);
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
          fetchForms(orgId);
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
          fetchForms(orgId);
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
