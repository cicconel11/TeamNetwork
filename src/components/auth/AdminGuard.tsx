"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

interface AdminGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

// Auth check states: null = loading, "authenticated" = has user, "unauthenticated" = no user
type AuthState = "loading" | "authenticated" | "unauthenticated";

export function AdminGuard({ children, fallback }: AdminGuardProps) {
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const params = useParams();
  const router = useRouter();
  const orgSlug = params.orgSlug as string;

  const checkAuth = useCallback(async () => {
    const supabase = createClient();
    
    // Helper to check admin role for a given user ID
    const verifyAdminRole = async (userId: string) => {
      const { data: orgs, error: orgError } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .limit(1);

      const org = orgs?.[0];
      if (!org || orgError) {
        console.log("[AdminGuard] Org not found:", orgSlug, orgError?.message);
        setIsAdmin(false);
        return;
      }

      const { data: role } = await supabase
        .from("user_organization_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("organization_id", org.id)
        .single();

      console.log("[AdminGuard] User role for org:", role?.role || "none");
      setIsAdmin(role?.role === "admin");
    };
    
    try {
      // Get current user - this reads from cookies
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      
      console.log("[AdminGuard] Auth check result:", user ? `user:${user.id.slice(0, 8)}` : "no-user", userError?.message || "");
      
      if (!user) {
        // Double-check by trying to get session (in case getUser failed but session exists)
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          console.log("[AdminGuard] No session found, redirecting to login");
          setAuthState("unauthenticated");
          // Use replace to avoid back button loop
          router.replace(`/auth/login?redirect=/${orgSlug}`);
          return;
        }
        // Session exists but getUser failed - try again with session user
        if (session.user) {
          console.log("[AdminGuard] Found user via session:", session.user.id.slice(0, 8));
          setAuthState("authenticated");
          await verifyAdminRole(session.user.id);
          return;
        }
      }
      
      setAuthState("authenticated");
      await verifyAdminRole(user!.id);
    } catch (err) {
      console.error("[AdminGuard] Error checking auth:", err);
      setAuthState("unauthenticated");
      router.replace(`/auth/login?redirect=/${orgSlug}`);
    }
  }, [orgSlug, router]);

  useEffect(() => {
    checkAuth();
    
    // Also listen for auth state changes
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      console.log("[AdminGuard] Auth state changed:", event, session?.user?.id?.slice(0, 8) || "no-user");
      if (event === "SIGNED_OUT") {
        setAuthState("unauthenticated");
        router.replace(`/auth/login?redirect=/${orgSlug}`);
      } else if (event === "SIGNED_IN" && session?.user) {
        setAuthState("authenticated");
        // Re-check admin status
        checkAuth();
      }
    });
    
    return () => {
      subscription.unsubscribe();
    };
  }, [orgSlug, router, checkAuth]);

  // Show loading while checking auth
  if (authState === "loading" || (authState === "authenticated" && isAdmin === null)) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="animate-spin h-8 w-8 border-4 border-org-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  // If unauthenticated, we're redirecting - show loading
  if (authState === "unauthenticated") {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="animate-spin h-8 w-8 border-4 border-org-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAdmin) {
    return fallback || (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <div className="h-16 w-16 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center mb-4">
          <svg className="h-8 w-8 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">Access Denied</h2>
        <p className="text-muted-foreground max-w-sm">
          You don&apos;t have permission to access this page. Only organization admins can perform this action.
        </p>
        <button
          onClick={() => router.back()}
          className="mt-4 px-4 py-2 bg-muted text-foreground rounded-xl hover:bg-border transition-colors"
        >
          Go Back
        </button>
      </div>
    );
  }

  return <>{children}</>;
}

