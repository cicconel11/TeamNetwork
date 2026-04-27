import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireEnv } from "@/lib/env";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { buildErrorRedirect, runAgeValidationGate } from "@/lib/auth/callback-flow";
import { debugLog, maskPII } from "@/lib/debug";
import { createServiceClient } from "@/lib/supabase/service";
import { runLinkedInOidcSyncSafe } from "@/lib/linkedin/oidc-sync";
import { LINKEDIN_OIDC_PROVIDER } from "@/lib/linkedin/config";
import {
  buildMobileCallbackDeepLink,
  buildMobileErrorDeepLink,
  buildMobileHandoffInsert,
  mobileErrorFromCallbackRedirect,
} from "@/lib/auth/mobile-oauth";

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const requestedRedirect = requestUrl.searchParams.get("redirect");
  const redirect = sanitizeRedirectPath(requestedRedirect);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || requestUrl.origin;
  const errorParam = requestUrl.searchParams.get("error");
  const errorDescription = requestUrl.searchParams.get("error_description");
  const isMobileCallback = requestUrl.searchParams.get("mobile") === "1";

  debugLog("auth-callback", "Starting", {
    hasCode: !!code,
    redirect,
    origin: requestUrl.origin,
    siteUrl,
    host: request.headers.get("host"),
    incomingCookies: request.cookies.getAll().map((c) => c.name),
  });

  // Handle OAuth errors — preserve redirect + mode so the error page can route back
  if (errorParam) {
    console.error("[auth/callback] OAuth error:", errorParam, errorDescription);
    if (isMobileCallback) {
      return NextResponse.redirect(buildMobileErrorDeepLink(errorParam, errorDescription));
    }
    return NextResponse.redirect(
      buildErrorRedirect(siteUrl, errorDescription || errorParam, redirect, requestUrl.searchParams.get("mode"))
    );
  }

  if (code) {
    // Create a redirect response first - we'll add cookies to it
    const redirectUrl = new URL(redirect, siteUrl);
    const response = NextResponse.redirect(redirectUrl);

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          debugLog("auth-callback", "setAll called with", cookiesToSet.length, "cookies:", cookiesToSet.map(c => c.name));
          cookiesToSet.forEach(({ name, value, options }) => {
            // Ensure cookies are set with correct options for cross-route access
            // Domain is set to .myteamnetwork.com to work across www and non-www
            response.cookies.set(name, value, {
              ...options,
              path: "/",  // Always use root path for auth cookies
              sameSite: "lax",
              secure: process.env.NODE_ENV === "production",
              // Let browser use default domain to avoid iOS Safari ITP issues
              domain: undefined,
            });
          });
        },
      },
    });

    debugLog("auth-callback", "Exchanging code for session...");
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("[auth/callback] Exchange error:", error.message);
      if (isMobileCallback) {
        return NextResponse.redirect(buildMobileErrorDeepLink("exchange_failed", error.message));
      }
      return NextResponse.redirect(
        buildErrorRedirect(siteUrl, error.message, redirect, requestUrl.searchParams.get("mode"))
      );
    }

    if (data.session) {
      debugLog("auth-callback", "Success! User:", maskPII(data.session.user.id));

      // --- Defensive OAuth identity merge ---
      // Guard: if Supabase created a fresh UUID for this sign-in but another UUID
      // with the same email already has org memberships, copy those memberships here.
      // This ensures continuity even if the Dashboard auto-link setting hasn't
      // yet prevented duplicate account creation.
      try {
        const currentUser = data.session.user;
        const currentEmail = currentUser.email;
        const isNewAccount =
          currentUser.created_at != null &&
          Date.now() - new Date(currentUser.created_at).getTime() < 60_000;

        if (currentEmail && isNewAccount) {
          const serviceClient = createServiceClient();

          const { data: duplicateUsers } = await serviceClient
            .from("users")
            .select("id")
            .eq("email", currentEmail)
            .neq("id", currentUser.id);

          if (duplicateUsers && duplicateUsers.length > 0) {
            debugLog("auth-callback", "Duplicate accounts detected for email, copying memberships", {
              currentUserId: maskPII(currentUser.id),
              duplicateCount: duplicateUsers.length,
            });

            for (const dupUser of duplicateUsers) {
              const { data: sourceRoles } = await serviceClient
                .from("user_organization_roles")
                .select("organization_id, role, status, created_at")
                .eq("user_id", dupUser.id);

              if (!sourceRoles || sourceRoles.length === 0) continue;

              const rowsToInsert = sourceRoles.map((r) => ({
                user_id: currentUser.id,
                organization_id: r.organization_id,
                role: r.role,
                status: r.status,
                created_at: r.created_at,
              }));

              const { error: insertError } = await serviceClient
                .from("user_organization_roles")
                .upsert(rowsToInsert, {
                  onConflict: "user_id,organization_id",
                  ignoreDuplicates: true,
                });

              if (insertError) {
                console.error(
                  "[auth/callback] Failed to copy org memberships from duplicate:",
                  maskPII(dupUser.id),
                  insertError.message
                );
              } else {
                debugLog("auth-callback", "Copied memberships from duplicate", {
                  from: maskPII(dupUser.id),
                  count: sourceRoles.length,
                });
              }
            }
          }
        }
      } catch (mergeError) {
        // Never block sign-in due to merge failure — log and continue.
        console.error("[auth/callback] Defensive merge failed (non-fatal):", mergeError);
      }
      // --- End defensive OAuth identity merge ---

      const ageGateResult = await runAgeValidationGate({
        requestUrl,
        siteUrl,
        requestedRedirect,
        user: {
          id: data.session.user.id,
          created_at: data.session.user.created_at,
          user_metadata: data.session.user.user_metadata,
        },
        persistAgeMetadata: async (metadata) => {
          const { error: updateError } = await supabase.auth.updateUser({
            data: metadata,
          });
          if (!updateError) {
            return;
          }

          console.error("[auth/callback] Failed to persist age metadata via session client:", updateError.message);

          const serviceSupabase = createServiceClient();
          const { error: adminUpdateError } = await serviceSupabase.auth.admin.updateUserById(
            data.session.user.id,
            { user_metadata: { ...(data.session.user.user_metadata ?? {}), ...metadata } }
          );
          if (adminUpdateError) {
            console.error("[auth/callback] Failed to persist age metadata via admin client:", adminUpdateError.message);
            throw adminUpdateError;
          }
        },
        cleanupUnvalidatedSignup: async () => {
          const serviceSupabase = createServiceClient();
          const { error: deleteError } = await serviceSupabase.auth.admin.deleteUser(data.session.user.id);
          if (deleteError) {
            console.error("[auth/callback] Failed to delete unvalidated OAuth user:", deleteError.message);
          }

          const { error: signOutError } = await supabase.auth.signOut();
          if (signOutError) {
            console.error("[auth/callback] Failed to clear OAuth session after cleanup:", signOutError.message);
          }
        },
      });

      if (ageGateResult.kind === "redirect") {
        debugLog("auth-callback", "Age validation redirect:", ageGateResult.location);
        if (isMobileCallback) {
          return NextResponse.redirect(mobileErrorFromCallbackRedirect(ageGateResult.location));
        }
        return NextResponse.redirect(ageGateResult.location);
      }

      // Best-effort sync in the background so redirect latency stays off the login path.
      // Errors are handled inside runLinkedInOidcSyncSafe.
      if (data.session.user.app_metadata?.provider === LINKEDIN_OIDC_PROVIDER) {
        queueMicrotask(() => {
          void runLinkedInOidcSyncSafe(createServiceClient, data.session.user);
        });
      }

      debugLog("auth-callback", "Cookies set:", response.cookies.getAll().map((c) => ({
        name: c.name,
        domain: (c as { domain?: string }).domain || "default",
        path: c.path || "/",
        secure: c.secure,
      })));
      if (isMobileCallback) {
        try {
          const serviceClient = createServiceClient();
          const { code: handoffCode, row } = buildMobileHandoffInsert(data.session);
          const { error: handoffError } = await (serviceClient as any)
            .from("mobile_auth_handoffs")
            .insert(row);

          if (handoffError) {
            console.error("[auth/callback] Failed to create mobile auth handoff:", handoffError.message);
            return NextResponse.redirect(
              buildMobileErrorDeepLink("handoff_failed", "Could not complete mobile sign in.")
            );
          }

          return NextResponse.redirect(buildMobileCallbackDeepLink({ handoff_code: handoffCode }));
        } catch (handoffError) {
          console.error("[auth/callback] Mobile auth handoff failed:", handoffError);
          return NextResponse.redirect(
            buildMobileErrorDeepLink("handoff_failed", "Could not complete mobile sign in.")
          );
        }
      }
      debugLog("auth-callback", "Redirecting to:", redirectUrl.toString());
      return response;
    }

    console.error("[auth/callback] No session returned");
  }

  if (isMobileCallback) {
    return NextResponse.redirect(buildMobileErrorDeepLink("missing_session", "Authentication did not return a session."));
  }
  return NextResponse.redirect(`${siteUrl}/auth/error`);
}
