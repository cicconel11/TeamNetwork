import Link from "next/link";
import { LoginClient } from "./LoginClient";

export default function LoginPage() {
  // Read env var on server side and pass to client
  const hcaptchaSiteKey = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY || "";
  
  // Debug: log on server side during render
  console.log("[LoginPage] NEXT_PUBLIC_HCAPTCHA_SITE_KEY:", hcaptchaSiteKey ? `${hcaptchaSiteKey.substring(0, 8)}...` : "MISSING");

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-block">
            <h1 className="text-3xl font-bold text-foreground">
              Team<span className="text-emerald-500">Network</span>
            </h1>
          </Link>
          <p className="text-muted-foreground mt-2">Sign in to your account</p>
        </div>

        <LoginClient hcaptchaSiteKey={hcaptchaSiteKey} />
      </div>
    </div>
  );
}
