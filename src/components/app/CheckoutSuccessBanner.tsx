"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";

type BannerStatus = "syncing" | "resolving" | "success" | "redirecting" | "error";

interface CheckoutSuccessBannerProps {
  orgSlug: string;
  organizationId?: string;
}

export function CheckoutSuccessBanner({ orgSlug, organizationId: initialOrgId }: CheckoutSuccessBannerProps) {
  const router = useRouter();
  const [status, setStatus] = useState<BannerStatus>("syncing");
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [resolvedOrgId, setResolvedOrgId] = useState<string | undefined>(initialOrgId);
  
  // Use refs to track mounted state and timers for cleanup
  const isMounted = useRef(true);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // Helper to safely schedule a timeout with cleanup tracking
  const safeTimeout = useCallback((fn: () => void, delay: number) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      if (isMounted.current) {
        fn();
      }
    }, delay);
  }, []);

  // Poll for org ID by slug if not provided
  const resolveOrgBySlug = useCallback(async (): Promise<string | undefined> => {
    try {
      const res = await fetch(`/api/organizations/by-slug/${encodeURIComponent(orgSlug)}`);
      if (res.ok) {
        const data = await res.json();
        return data.id || undefined;
      }
    } catch {
      // Ignore errors, will retry
    }
    return undefined;
  }, [orgSlug]);

  // Main sync effect
  useEffect(() => {
    const syncSubscription = async () => {
      if (!isMounted.current) return;
      
      let orgId = resolvedOrgId;

      // Step 1: If no org ID, try to resolve by slug
      if (!orgId) {
        setStatus("resolving");
        orgId = await resolveOrgBySlug();
        
        if (orgId && isMounted.current) {
          setResolvedOrgId(orgId);
        }
      }

      if (!isMounted.current) return;

      // Step 2: If we have an org ID, try to reconcile
      if (orgId) {
        setStatus("syncing");
        try {
          const res = await fetch(`/api/organizations/${orgId}/reconcile-subscription`, {
            method: "POST",
          });
          
          if (res.ok && isMounted.current) {
            setStatus("success");
            // Short delay to show success message before redirect
            safeTimeout(() => {
              setStatus("redirecting");
              router.push(`/${orgSlug}`);
            }, 1500);
            return;
          }
        } catch {
          // Fall through to retry logic
        }
      }

      if (!isMounted.current) return;

      // Step 3: Retry logic
      if (retryCount < 5) {
        safeTimeout(() => {
          setRetryCount((c) => c + 1);
        }, 2000); // Retry every 2 seconds
      } else {
        // After 5 retries (~10 seconds), try redirecting anyway
        // The layout will show BillingGate if subscription isn't ready
        setStatus("redirecting");
        router.push(`/${orgSlug}`);
      }
    };

    syncSubscription();
  }, [resolvedOrgId, orgSlug, retryCount, router, resolveOrgBySlug, safeTimeout]);

  const getMessage = () => {
    switch (status) {
      case "resolving":
        return "Looking up your organization...";
      case "syncing":
        return retryCount === 0
          ? "Setting up your organization..."
          : `Syncing subscription... (attempt ${retryCount + 1}/5)`;
      case "success":
        return "Organization created successfully!";
      case "redirecting":
        return "Redirecting to your organization...";
      case "error":
        return error || "Something went wrong. Please try again.";
    }
  };

  const getIcon = () => {
    if (status === "error") {
      return (
        <svg className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
      );
    }
    
    if (status === "success") {
      return (
        <svg className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    }

    // Spinning loader for syncing/resolving/redirecting
    return (
      <svg className="h-5 w-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
    );
  };

  const getBgClass = () => {
    if (status === "error") {
      return "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20";
    }
    if (status === "success") {
      return "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20";
    }
    return "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20";
  };

  const getTextClass = () => {
    if (status === "error") {
      return "text-red-700 dark:text-red-300";
    }
    if (status === "success") {
      return "text-green-700 dark:text-green-300";
    }
    return "text-emerald-700 dark:text-emerald-300";
  };

  return (
    <Card className={`p-4 mb-6 ${getBgClass()}`}>
      <div className="flex items-center gap-3">
        {getIcon()}
        <p className={`text-sm ${getTextClass()}`}>
          {getMessage()}
        </p>
      </div>
    </Card>
  );
}
