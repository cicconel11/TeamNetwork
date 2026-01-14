import Link from "next/link";
import { Card, Button } from "@/components/ui";

export default function AuthErrorPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <div className="mb-8">
          <div className="h-16 w-16 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center mx-auto mb-4">
            <svg className="h-8 w-8 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Authentication Error</h1>
          <p className="text-muted-foreground mt-2">
            Something went wrong during authentication. Please try again.
          </p>
        </div>

        <Card className="p-6">
          <div className="space-y-4">
            <Link href="/auth/login">
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

