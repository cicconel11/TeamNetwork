"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Input, Card } from "@/components/ui";
import { safeString } from "@/lib/schemas";

const parentsJoinSchema = z.object({
  email: z.string().trim().email("Please enter a valid email address").max(320).transform(v => v.toLowerCase()),
  first_name: safeString(100),
  last_name: safeString(100),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

type ParentsJoinForm = z.infer<typeof parentsJoinSchema>;

function ParentsJoinFormComponent() {
  const searchParams = useSearchParams();
  const orgId = searchParams.get("org");
  const code = searchParams.get("code");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ParentsJoinForm>({
    resolver: zodResolver(parentsJoinSchema),
  });

  // Missing or malformed link — show an error immediately
  if (!orgId || !code) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border bg-card">
          <div className="max-w-6xl mx-auto px-6 py-4">
            <Link href="/">
              <h1 className="text-2xl font-bold text-foreground">
                Team<span className="text-emerald-500">Network</span>
              </h1>
            </Link>
          </div>
        </header>
        <main className="max-w-md mx-auto px-6 py-12">
          <Card className="p-8 text-center">
            <div className="h-16 w-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Invalid Link</h2>
            <p className="text-muted-foreground">
              This invite link is missing required information. Please use the link provided by your organization.
            </p>
          </Card>
        </main>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border bg-card">
          <div className="max-w-6xl mx-auto px-6 py-4">
            <Link href="/">
              <h1 className="text-2xl font-bold text-foreground">
                Team<span className="text-emerald-500">Network</span>
              </h1>
            </Link>
          </div>
        </header>
        <main className="max-w-md mx-auto px-6 py-12">
          <Card className="p-8 text-center">
            <div className="h-16 w-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
              <svg className="h-8 w-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Account Created!</h2>
            <p className="text-muted-foreground mb-6">
              Your parent account has been set up. Sign in to access the organization.
            </p>
            <Link href="/auth/login">
              <Button className="w-full">Sign In</Button>
            </Link>
          </Card>
        </main>
      </div>
    );
  }

  const onSubmit = async (data: ParentsJoinForm) => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/organizations/${orgId}/parents/invite/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          email: data.email,
          first_name: data.first_name,
          last_name: data.last_name,
          password: data.password,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? "Something went wrong. Please try again.");
        return;
      }

      setSuccess(true);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <Link href="/">
            <h1 className="text-2xl font-bold text-foreground">
              Team<span className="text-emerald-500">Network</span>
            </h1>
          </Link>
        </div>
      </header>

      <main className="max-w-md mx-auto px-6 py-12">
        <Card className="p-8">
          <div className="text-center mb-8">
            <div className="h-16 w-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
              <svg className="h-8 w-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Create Your Account</h2>
            <p className="text-muted-foreground">
              You&apos;ve been invited as a parent/guardian. Set up your account below.
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-4">
              <Input
                label="Email"
                type="email"
                autoComplete="email"
                error={errors.email?.message}
                {...register("email")}
              />
              <Input
                label="First Name"
                type="text"
                autoComplete="given-name"
                error={errors.first_name?.message}
                {...register("first_name")}
              />
              <Input
                label="Last Name"
                type="text"
                autoComplete="family-name"
                error={errors.last_name?.message}
                {...register("last_name")}
              />
              <Input
                label="Password"
                type="password"
                autoComplete="new-password"
                error={errors.password?.message}
                {...register("password")}
              />
              <Button type="submit" className="w-full" isLoading={isLoading}>
                Create Account
              </Button>
            </div>
          </form>

          <div className="mt-6 pt-6 border-t border-border text-center">
            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/auth/login" className="text-emerald-600 hover:underline font-medium">
                Sign in
              </Link>
            </p>
          </div>
        </Card>
      </main>
    </div>
  );
}

export default function ParentsJoinPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="animate-pulse">
            <div className="h-8 w-48 bg-muted rounded-xl" />
          </div>
        </div>
      }
    >
      <ParentsJoinFormComponent />
    </Suspense>
  );
}
