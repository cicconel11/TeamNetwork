import Link from "next/link";
import { Card, Button } from "@/components/ui";
import { buildAuthRetryHref } from "@/lib/auth/signup-flow";

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; redirect?: string; mode?: string }>;
}) {
  const params = await searchParams;
  const message = params?.message || "Something went wrong during authentication. Please try again.";
  const retryHref = buildAuthRetryHref(params?.mode, params?.redirect);

  return (
    <div className="auth-page min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <div className="mb-8">
          <div className="h-16 w-16 rounded-full bg-red-900/20 flex items-center justify-center mx-auto mb-4">
            <svg className="h-8 w-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Authentication Error</h1>
          <p className="text-white/50 mt-2">
            {message}
          </p>
        </div>

        <Card className="p-6">
          <div className="space-y-4">
            <Link href={retryHref}>
              <Button className="w-full">Try Again</Button>
            </Link>
            <Link href="/">
              <Button variant="secondary" className="w-full">Go Home</Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
