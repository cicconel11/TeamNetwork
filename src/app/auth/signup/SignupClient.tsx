"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Card, HCaptcha, HCaptchaRef } from "@/components/ui";
import { useCaptcha } from "@/hooks/useCaptcha";
import { signupSchema, type SignupForm, type AgeBracket } from "@/lib/schemas/auth";
import { AgeGate } from "@/components/auth/AgeGate";
import { FeedbackButton } from "@/components/feedback";

type SignupStep = "age_gate" | "registration";

const AGE_GATE_STORAGE_KEY = "signup_age_gate";

interface AgeGateData {
  ageBracket: AgeBracket;
  isMinor: boolean;
  token: string;
}

interface SignupClientProps {
  hcaptchaSiteKey: string;
}

export function SignupClient({ hcaptchaSiteKey }: SignupClientProps) {
  const router = useRouter();
  const [step, setStep] = useState<SignupStep>("age_gate");
  const [ageBracket, setAgeBracket] = useState<AgeBracket | null>(null);
  const [isMinor, setIsMinor] = useState<boolean | null>(null);
  const [ageToken, setAgeToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== "undefined" ? window.location.origin : "");

  // Restore age gate data from sessionStorage on mount
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(AGE_GATE_STORAGE_KEY);
      if (stored) {
        const data: AgeGateData = JSON.parse(stored);
        setAgeBracket(data.ageBracket);
        setIsMinor(data.isMinor);
        setAgeToken(data.token);
        setStep("registration");
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
    },
  });

  const captchaRef = useRef<HCaptchaRef>(null);
  const { token: captchaToken, isVerified, onVerify, onExpire, onError: onCaptchaError } = useCaptcha();

  const handleAgeGateComplete = async (bracket: AgeBracket) => {
    setIsValidating(true);
    setError(null);

    try {
      // Call server-side validation API
      const response = await fetch("/api/auth/validate-age", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ageBracket: bracket }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || "Unable to verify age. Please try again.");
        setIsValidating(false);
        return;
      }

      // Server says redirect (under-13)
      if (result.redirect) {
        router.push(result.redirect);
        return;
      }

      // Store age gate data with token in sessionStorage
      const resolvedAgeBracket = (result.ageBracket as AgeBracket) || bracket;
      const resolvedIsMinor =
        typeof result.isMinor === "boolean"
          ? result.isMinor
          : resolvedAgeBracket !== "18_plus";

      const data: AgeGateData = {
        ageBracket: resolvedAgeBracket,
        isMinor: resolvedIsMinor,
        token: result.token,
      };
      try {
        sessionStorage.setItem(AGE_GATE_STORAGE_KEY, JSON.stringify(data));
      } catch {
        // Ignore storage errors
      }

      setAgeBracket(resolvedAgeBracket);
      setIsMinor(resolvedIsMinor);
      setAgeToken(result.token);
      setStep("registration");
    } catch {
      setError("Unable to verify age. Please try again.");
    } finally {
      setIsValidating(false);
    }
  };

  const clearAgeGateData = () => {
    try {
      sessionStorage.removeItem(AGE_GATE_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  };

  const handleGoogleSignup = async () => {
    if (!ageBracket || isMinor === null || !ageToken) {
      setError("Please complete the date of birth step first");
      return;
    }

    setIsGoogleLoading(true);
    setError(null);

    const supabase = createClient()!;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${siteUrl}/auth/callback?redirect=/app`,
        queryParams: {
          // Pass age data as query params to be handled in callback
          age_bracket: ageBracket,
          is_minor: String(isMinor),
          age_token: ageToken,
        },
      },
    });

    if (error) {
      setError(error.message);
      setIsGoogleLoading(false);
    } else {
      clearAgeGateData();
    }
  };

  const onSubmit = async (data: SignupForm) => {
    if (!isVerified || !captchaToken) {
      setError("Please complete the captcha verification");
      return;
    }

    if (!ageBracket || isMinor === null || !ageToken) {
      setError("Please complete the date of birth step first");
      return;
    }

    setIsLoading(true);
    setError(null);

    const supabase = createClient()!;
    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          name: data.name,
          age_bracket: ageBracket,
          is_minor: isMinor,
          age_validation_token: ageToken,
        },
        emailRedirectTo: `${siteUrl}/auth/callback?redirect=/app`,
        captchaToken,
      },
    });

    if (error) {
      setError(error.message);
      setIsLoading(false);
      captchaRef.current?.reset();
      return;
    }

    clearAgeGateData();
    setMessage("Check your email to confirm your account!");
    setIsLoading(false);
    captchaRef.current?.reset();
  };

  // Render age gate step
  if (step === "age_gate") {
    return (
      <AgeGate
        onComplete={handleAgeGateComplete}
        isLoading={isValidating}
        error={error}
      />
    );
  }

  // Render registration step
  return (
    <Card className="p-6">
      <Button
        type="button"
        variant="secondary"
        className="w-full mb-6"
        onClick={handleGoogleSignup}
        isLoading={isGoogleLoading}
        data-testid="signup-google"
      >
        <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="currentColor"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="currentColor"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="currentColor"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        Continue with Google
      </Button>

      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">Or continue with email</span>
        </div>
      </div>

      {error && (
        <div data-testid="signup-error" className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
          <div className="mt-2 flex justify-end">
            <FeedbackButton context="signup" trigger="signup_error" />
          </div>
        </div>
      )}

      {message && (
        <div data-testid="signup-success" className="mb-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 text-sm">
          {message}
        </div>
      )}

      <form data-testid="signup-form" onSubmit={handleSubmit(onSubmit)}>
        <div className="space-y-4">
          <Input
            label="Full Name"
            type="text"
            placeholder="John Doe"
            data-testid="signup-name"
            error={errors.name?.message}
            {...register("name")}
          />

          <Input
            label="Email"
            type="email"
            placeholder="you@example.com"
            data-testid="signup-email"
            error={errors.email?.message}
            {...register("email")}
          />

          <Input
            label="Password"
            type="password"
            placeholder="••••••••"
            helperText="Must be at least 6 characters"
            data-testid="signup-password"
            error={errors.password?.message}
            {...register("password")}
          />

          <div className="flex justify-center">
            <HCaptcha
              siteKey={hcaptchaSiteKey}
              ref={captchaRef}
              onVerify={onVerify}
              onExpire={onExpire}
              onError={onCaptchaError}
              theme="light"
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            isLoading={isLoading}
            disabled={!isVerified}
            data-testid="signup-submit"
          >
            Create Account
          </Button>
        </div>
      </form>

      <div className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/auth/login" className="text-foreground font-medium hover:underline">
          Sign in
        </Link>
      </div>
    </Card>
  );
}
