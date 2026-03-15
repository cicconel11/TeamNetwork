import { AuthHeader } from "@/components/auth/AuthHeader";
import { LoginClient } from "./LoginClient";

// Force dynamic rendering so env vars are read at request time
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const hcaptchaSiteKey = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY || "";

  return (
    <div className="auth-page min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <AuthHeader subtitle="Sign in to your account" />

        <LoginClient hcaptchaSiteKey={hcaptchaSiteKey} />
      </div>
    </div>
  );
}
