"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface AdminGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function AdminGuard({ children, fallback }: AdminGuardProps) {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const params = useParams();
  const router = useRouter();
  const orgSlug = params.orgSlug as string;

  useEffect(() => {
    const checkAdmin = async () => {
      const supabase = createClient();
      
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push(`/auth/login?redirect=/${orgSlug}`);
        return;
      }

      // Get organization
      const { data: orgs, error: orgError } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .limit(1);

      const org = orgs?.[0];

      if (!org || orgError) {
        setIsAdmin(false);
        return;
      }

      // Check if user is admin for this org
      const { data: role } = await supabase
        .from("user_organization_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("organization_id", org.id)
        .single();

      setIsAdmin(role?.role === "admin");
    };

    checkAdmin();
  }, [orgSlug, router]);

  if (isAdmin === null) {
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

