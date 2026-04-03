import { AuthHeader } from "@/components/auth/AuthHeader";
import { isLinkedInLoginEnabled } from "@/lib/linkedin/config.server";
import { LoginClient } from "./LoginClient";
import { getTranslations } from "next-intl/server";

// Force dynamic rendering so env vars are read at request time
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const t = await getTranslations("auth");
  const hcaptchaSiteKey = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY || "";
  const linkedinOauthAvailable = isLinkedInLoginEnabled();

  return (
    <div className="auth-page min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <AuthHeader subtitle={t("signInToAccount")} />

        <LoginClient
          hcaptchaSiteKey={hcaptchaSiteKey}
          linkedinOauthAvailable={linkedinOauthAvailable}
        />
      </div>
    </div>
  );
}
