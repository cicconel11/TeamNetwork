import { AuthHeader } from "@/components/auth/AuthHeader";
import { SignupClient } from "./SignupClient";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { isLinkedInLoginEnabled } from "@/lib/linkedin/config.server";

// Force dynamic rendering so env vars are read at request time
export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; error?: string }>;
}) {
  const hcaptchaSiteKey = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY || "";
  const linkedinOauthAvailable = isLinkedInLoginEnabled();
  const params = await searchParams;
  const redirectTo = sanitizeRedirectPath(params?.redirect ?? null);
  const initialError = params?.error ?? null;

  return (
    <div className="auth-page min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <AuthHeader subtitle="Create your account" />

        <SignupClient
          hcaptchaSiteKey={hcaptchaSiteKey}
          linkedinOauthAvailable={linkedinOauthAvailable}
          redirectTo={redirectTo}
          initialError={initialError}
        />
      </div>
    </div>
  );
}
