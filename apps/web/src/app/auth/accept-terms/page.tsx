import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthHeader } from "@/components/auth/AuthHeader";
import { Card } from "@/components/ui";
import {
  hasAcceptedCurrentAgreementVersions,
  type UserAgreementVersion,
} from "@/lib/compliance/user-agreements";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { AcceptTermsClient } from "./AcceptTermsClient";

interface AcceptTermsPageProps {
  searchParams: Promise<{ redirect?: string }>;
}

export default async function AcceptTermsPage({ searchParams }: AcceptTermsPageProps) {
  const { redirect: redirectTo } = await searchParams;
  const safeRedirectTo = sanitizeRedirectPath(redirectTo ?? null);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Skip the interstitial once both current agreement versions are present.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: agreements } = await (supabase as any)
    .from("user_agreements")
    .select("agreement_type, version")
    .eq("user_id", user.id) as {
    data: UserAgreementVersion[] | null;
  };

  if (hasAcceptedCurrentAgreementVersions(agreements ?? [])) {
    redirect(safeRedirectTo);
  }

  return (
    <div className="auth-page min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <AuthHeader subtitle="Terms of Service" />

        <Card className="p-6">
          <div className="text-center mb-6">
            <h2 className="text-xl font-semibold text-white mb-2">
              Accept Terms to Continue
            </h2>
            <p className="text-white/50 text-sm">
              Please review and accept our Terms of Service and Privacy Policy to continue.
            </p>
          </div>

          <AcceptTermsClient redirectTo={safeRedirectTo} />
        </Card>
      </div>
    </div>
  );
}
