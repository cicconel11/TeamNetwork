import Link from "next/link";
import { SignupClient } from "./SignupClient";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";

// Force dynamic rendering so env vars are read at request time
export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  // Read env var on server side and pass to client
  const hcaptchaSiteKey = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY || "";
  const params = await searchParams;
  const redirectTo = sanitizeRedirectPath(params?.redirect ?? null);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-block">
            <h1 className="text-3xl font-bold text-foreground">
              Team<span className="text-emerald-500">Network</span>
            </h1>
          </Link>
          <p className="text-muted-foreground mt-2">Create your account</p>
        </div>

        <SignupClient hcaptchaSiteKey={hcaptchaSiteKey} redirectTo={redirectTo} />
      </div>
    </div>
  );
}
