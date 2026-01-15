import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

const HCAPTCHA_SECRET_KEY = process.env.HCAPTCHA_SECRET_KEY;
const HCAPTCHA_VERIFY_URL = "https://hcaptcha.com/siteverify";

interface HCaptchaResponse {
  success: boolean;
  challenge_ts?: string;
  hostname?: string;
  "error-codes"?: string[];
}

async function verifyHCaptcha(token: string): Promise<boolean> {
  if (!HCAPTCHA_SECRET_KEY) {
    console.error("HCAPTCHA_SECRET_KEY is not configured");
    return false;
  }

  try {
    const response = await fetch(HCAPTCHA_VERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        secret: HCAPTCHA_SECRET_KEY,
        response: token,
      }),
    });

    const data: HCaptchaResponse = await response.json();
    return data.success;
  } catch (error) {
    console.error("hCaptcha verification error:", error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, name, captchaToken } = body;

    // Validate required fields
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    if (!captchaToken) {
      return NextResponse.json(
        { error: "CAPTCHA verification is required" },
        { status: 400 }
      );
    }

    // Verify hCaptcha token server-side
    const isValidCaptcha = await verifyHCaptcha(captchaToken);
    if (!isValidCaptcha) {
      return NextResponse.json(
        { error: "CAPTCHA verification failed. Please try again." },
        { status: 400 }
      );
    }

    // Create user with Supabase service client (bypasses RLS)
    const supabase = createServiceClient();
    
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: false, // User will need to confirm via email
      user_metadata: {
        name: name || "",
      },
    });

    if (error) {
      // Handle specific Supabase errors
      if (error.message.includes("already registered")) {
        return NextResponse.json(
          { error: "An account with this email already exists" },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    // Send confirmation email
    if (data.user) {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.myteamnetwork.com";
      
      // Generate confirmation link
      const { error: linkError } = await supabase.auth.admin.generateLink({
        type: "signup",
        email,
        options: {
          redirectTo: `${siteUrl}/auth/callback?redirect=/app`,
        },
      });

      if (linkError) {
        console.error("Error generating confirmation link:", linkError);
      }
    }

    return NextResponse.json({
      success: true,
      message: "Check your email to confirm your account!",
    });
  } catch (error) {
    console.error("Signup API error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
