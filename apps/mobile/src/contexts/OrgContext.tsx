import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useGlobalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase";

interface OrgContextValue {
  orgSlug: string;
  orgId: string | null;
  isLoading: boolean;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ children }: { children: ReactNode }) {
  const { orgSlug } = useGlobalSearchParams<{ orgSlug: string }>();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function fetchOrgId() {
      if (!orgSlug) {
        setIsLoading(false);
        return;
      }

      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .single();

      if (isMounted) {
        setOrgId(org?.id ?? null);
        setIsLoading(false);
      }
    }

    setIsLoading(true);
    fetchOrgId();

    return () => {
      isMounted = false;
    };
  }, [orgSlug]);

  return (
    <OrgContext.Provider value={{ orgSlug: orgSlug ?? "", orgId, isLoading }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg(): OrgContextValue {
  const context = useContext(OrgContext);
  if (!context) {
    throw new Error("useOrg must be used within an OrgProvider");
  }
  return context;
}
