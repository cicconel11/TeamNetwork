"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { MembershipStatus, UserRole } from "@teammeet/types";
import { normalizeRole, roleFlags, type OrgRole } from "@/lib/auth/role-utils";

type State = {
  role: OrgRole | null;
  status: MembershipStatus | null;
  userId: string | null;
  loading: boolean;
};

export function useOrgRole() {
  const params = useParams();
  const orgSlug = params?.orgSlug as string | undefined;
  const [state, setState] = useState<State>({
    role: null,
    status: null,
    userId: null,
    loading: true,
  });

  useEffect(() => {
    let isMounted = true;
    const fetchRole = async () => {
      if (!orgSlug) {
        setState((prev) => ({ ...prev, loading: false }));
        return;
      }

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (isMounted) {
          setState({ role: null, status: null, userId: null, loading: false });
        }
        return;
      }

      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .maybeSingle();

      if (!org) {
        if (isMounted) setState({ role: null, status: null, userId: user.id, loading: false });
        return;
      }

      const { data } = await supabase
        .from("user_organization_roles")
        .select("role,status")
        .eq("organization_id", org.id)
        .eq("user_id", user.id)
        .maybeSingle();

      const role = normalizeRole((data?.role as UserRole | null) ?? null);
      const status = (data?.status as MembershipStatus | null) ?? null;

      if (isMounted) {
        setState({ role, status, userId: user.id, loading: false });
      }
    };

    fetchRole();

    return () => {
      isMounted = false;
    };
  }, [orgSlug]);

  return {
    ...state,
    ...roleFlags(state.role),
  };
}

