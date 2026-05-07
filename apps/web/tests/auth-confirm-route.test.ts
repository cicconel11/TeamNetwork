import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "test-anon-key";
process.env.NEXT_PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.example.com";

const { createRecoveryConfirmHandler } = await import("../src/lib/auth/recovery-confirm-handler.ts");

test("confirm route verifies recovery token, sets cookies, and redirects to reset-password", async () => {
  let verifyArgs: { type: string; token_hash: string } | null = null;

  const handler = createRecoveryConfirmHandler(((url, key, options) => {
    assert.equal(url, "https://test.supabase.co");
    assert.equal(key, "test-anon-key");

    return {
      auth: {
        verifyOtp: async (args: { type: string; token_hash: string }) => {
          verifyArgs = args;
          options.cookies.setAll([
            {
              name: "sb-access-token",
              value: "token-value",
              options: { httpOnly: true },
            },
          ]);
          return { error: null };
        },
      },
    };
  }) as never);

  const request = new NextRequest(
    "https://www.example.com/auth/confirm?token_hash=abc123&type=recovery&next=%2Fauth%2Freset-password%3Fredirect%3D%252Fdashboard"
  );

  const response = await handler(request);

  assert.deepEqual(verifyArgs, {
    type: "recovery",
    token_hash: "abc123",
  });
  assert.equal(
    response.headers.get("location"),
    "https://www.example.com/auth/reset-password?redirect=%2Fdashboard"
  );
  assert.match(response.headers.get("set-cookie") ?? "", /sb-access-token=token-value/);
});

test("confirm route rejects invalid next paths and falls back to reset-password", async () => {
  const handler = createRecoveryConfirmHandler((() => ({
    auth: {
      verifyOtp: async () => ({ error: null }),
    },
  })) as never);

  const request = new NextRequest(
    "https://www.example.com/auth/confirm?token_hash=abc123&type=recovery&next=%2Fauth%2Flogin"
  );

  const response = await handler(request);

  assert.equal(
    response.headers.get("location"),
    "https://www.example.com/auth/reset-password"
  );
});

test("confirm route redirects to auth error when token verification fails", async () => {
  const handler = createRecoveryConfirmHandler((() => ({
    auth: {
      verifyOtp: async () => ({
        error: { message: "Recovery token expired" },
      }),
    },
  })) as never);

  const request = new NextRequest(
    "https://www.example.com/auth/confirm?token_hash=expired&type=recovery"
  );

  const response = await handler(request);
  const location = response.headers.get("location");

  assert.ok(location);
  const redirectUrl = new URL(location);
  assert.equal(redirectUrl.pathname, "/auth/error");
  assert.equal(redirectUrl.searchParams.get("message"), "Recovery token expired");
});
