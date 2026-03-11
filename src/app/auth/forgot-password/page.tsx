import { AuthHeader } from "@/components/auth/AuthHeader";
import { ForgotPasswordClient } from "./ForgotPasswordClient";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  const hcaptchaSiteKey = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY || "";

  return (
    <div className="auth-page min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <AuthHeader subtitle="Reset your password" />

        <ForgotPasswordClient hcaptchaSiteKey={hcaptchaSiteKey} />
      </div>
    </div>
  );
}
