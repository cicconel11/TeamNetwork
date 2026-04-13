import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { AuthHeader } from "@/components/auth/AuthHeader";
import { Card } from "@/components/ui";
import { CURRENT_TOS_VERSION } from "@/lib/compliance/user-agreements";
import { AcceptTermsClient } from "./AcceptTermsClient";

interface AcceptTermsPageProps {
  searchParams: Promise<{ redirect?: string }>;
}

export default async function AcceptTermsPage({ searchParams }: AcceptTermsPageProps) {
  const { redirect: redirectTo } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Check if user has already accepted current ToS version
  const serviceSupabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (serviceSupabase as any)
    .from("user_agreements")
    .select("id")
    .eq("user_id", user.id)
    .eq("agreement_type", "terms_of_service")
    .eq("version", CURRENT_TOS_VERSION)
    .limit(1);

  if (existing && existing.length > 0) {
    redirect(redirectTo || "/app");
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

          <AcceptTermsClient redirectTo={redirectTo || "/app"} />
        </Card>
      </div>
    </div>
  );
}
