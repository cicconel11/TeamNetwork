import { AuthHeader } from "@/components/auth/AuthHeader";
import { getCaptchaSiteKey } from "@/lib/security/captcha";
import { getTranslations } from "next-intl/server";
import { ClaimAccountClient } from "./ClaimAccountClient";

// Force dynamic rendering so env vars are read at request time
export const dynamic = "force-dynamic";

export default async function ClaimAccountPage() {
  const t = await getTranslations("auth");
  const captchaSiteKey = getCaptchaSiteKey();

  return (
    <div className="auth-page min-h-screen flex items-center justify-center px-4 py-6 sm:py-8">
      <div className="w-full max-w-md">
        <AuthHeader subtitle={t("claimSubtitle")} />
        <ClaimAccountClient captchaSiteKey={captchaSiteKey} />
      </div>
    </div>
  );
}
