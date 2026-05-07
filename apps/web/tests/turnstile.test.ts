/**
 * Cloudflare Turnstile verification tests.
 * Covers the default captcha provider plus explicit legacy-provider dispatch.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { verifyCaptcha } from "../src/lib/security/captcha.ts";

const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const originalEnv = { ...process.env };
function resetEnv() {
  process.env = { ...originalEnv };
}

describe("Turnstile verification", () => {
  it("rejects missing/empty tokens", async () => {
    process.env.NODE_ENV = "production";
    process.env.TURNSTILE_SECRET_KEY = "test-secret";

    for (const token of ["", "   ", "\t", "\n"]) {
      const result = await verifyCaptcha(token, undefined, {
        provider: "turnstile",
        secretKey: "test-secret",
        skipInDevelopment: false,
      });
      assert.strictEqual(result.success, false);
      assert.ok(result.error_codes?.includes("missing-input-response"));
    }

    resetEnv();
  });

  it("returns missing-secret-key when key absent in prod", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.TURNSTILE_SECRET_KEY;

    const result = await verifyCaptcha("some-token", undefined, {
      provider: "turnstile",
      skipInDevelopment: false,
    });
    assert.strictEqual(result.success, false);
    assert.ok(result.error_codes?.includes("missing-secret-key"));

    resetEnv();
  });

  it("returns success in dev mode with no secret key (bypass)", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.TURNSTILE_SECRET_KEY;

    const result = await verifyCaptcha("some-token", undefined, {
      provider: "turnstile",
    });
    assert.strictEqual(result.success, true);

    resetEnv();
  });

  it("calls the Turnstile siteverify URL (not hCaptcha)", async () => {
    process.env.NODE_ENV = "production";
    const originalFetch = globalThis.fetch;
    let calledUrl: string | null = null;

    try {
      globalThis.fetch = async (url: string | URL | Request) => {
        calledUrl = typeof url === "string" ? url : url.toString();
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      const result = await verifyCaptcha("valid-token", undefined, {
        provider: "turnstile",
        secretKey: "test-secret",
        skipInDevelopment: false,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(calledUrl, TURNSTILE_URL);
    } finally {
      globalThis.fetch = originalFetch;
      resetEnv();
    }
  });

  it("maps error-codes from response", async () => {
    process.env.NODE_ENV = "production";
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            success: false,
            "error-codes": ["invalid-input-response"],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );

      const result = await verifyCaptcha("bad-token", undefined, {
        provider: "turnstile",
        secretKey: "test-secret",
        skipInDevelopment: false,
      });

      assert.strictEqual(result.success, false);
      assert.ok(result.error_codes?.includes("invalid-input-response"));
    } finally {
      globalThis.fetch = originalFetch;
      resetEnv();
    }
  });

  it("honours timeout setting", async () => {
    process.env.NODE_ENV = "production";
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = (_url, options?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const handle = setTimeout(
            () => resolve(new Response(JSON.stringify({ success: true }))),
            500,
          );
          options?.signal?.addEventListener("abort", () => {
            clearTimeout(handle);
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        });

      const start = Date.now();
      const result = await verifyCaptcha("token", undefined, {
        provider: "turnstile",
        secretKey: "test-secret",
        skipInDevelopment: false,
        timeout: 50,
      });
      const elapsed = Date.now() - start;

      assert.strictEqual(result.success, false);
      assert.ok(result.error_codes?.includes("timeout"));
      assert.ok(elapsed < 200, `elapsed=${elapsed}ms`);
    } finally {
      globalThis.fetch = originalFetch;
      resetEnv();
    }
  });

  it("returns network-error on fetch failure", async () => {
    process.env.NODE_ENV = "production";
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        throw new Error("network down");
      };

      const result = await verifyCaptcha("token", undefined, {
        provider: "turnstile",
        secretKey: "test-secret",
        skipInDevelopment: false,
      });

      assert.strictEqual(result.success, false);
      assert.ok(result.error_codes?.includes("network-error"));
    } finally {
      globalThis.fetch = originalFetch;
      resetEnv();
    }
  });
});

describe("Dispatcher (captcha provider routing)", () => {
  it("routes to Turnstile URL when provider=turnstile", async () => {
    process.env.NODE_ENV = "production";
    const originalFetch = globalThis.fetch;
    let calledUrl: string | null = null;

    try {
      globalThis.fetch = async (url: string | URL | Request) => {
        calledUrl = typeof url === "string" ? url : url.toString();
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      await verifyCaptcha("t", undefined, {
        provider: "turnstile",
        secretKey: "s",
        skipInDevelopment: false,
      });
      assert.strictEqual(calledUrl, TURNSTILE_URL);
    } finally {
      globalThis.fetch = originalFetch;
      resetEnv();
    }
  });

  it("routes to Turnstile URL by default (no provider override)", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.CAPTCHA_PROVIDER;
    const originalFetch = globalThis.fetch;
    let calledUrl: string | null = null;

    try {
      globalThis.fetch = async (url: string | URL | Request) => {
        calledUrl = typeof url === "string" ? url : url.toString();
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      await verifyCaptcha("t", undefined, {
        secretKey: "s",
        skipInDevelopment: false,
      });
      assert.strictEqual(calledUrl, TURNSTILE_URL);
    } finally {
      globalThis.fetch = originalFetch;
      resetEnv();
    }
  });

  it("routes to hCaptcha when CAPTCHA_PROVIDER env is hcaptcha", async () => {
    process.env.NODE_ENV = "production";
    process.env.CAPTCHA_PROVIDER = "hcaptcha";
    const originalFetch = globalThis.fetch;
    let calledUrl: string | null = null;

    try {
      globalThis.fetch = async (url: string | URL | Request) => {
        calledUrl = typeof url === "string" ? url : url.toString();
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      await verifyCaptcha("t", undefined, {
        secretKey: "s",
        skipInDevelopment: false,
      });
      assert.strictEqual(calledUrl, "https://api.hcaptcha.com/siteverify");
    } finally {
      globalThis.fetch = originalFetch;
      resetEnv();
    }
  });

  it("routes to Turnstile when CAPTCHA_PROVIDER env is turnstile", async () => {
    process.env.NODE_ENV = "production";
    process.env.CAPTCHA_PROVIDER = "turnstile";
    const originalFetch = globalThis.fetch;
    let calledUrl: string | null = null;

    try {
      globalThis.fetch = async (url: string | URL | Request) => {
        calledUrl = typeof url === "string" ? url : url.toString();
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      await verifyCaptcha("t", undefined, {
        secretKey: "s",
        skipInDevelopment: false,
      });
      assert.strictEqual(calledUrl, TURNSTILE_URL);
    } finally {
      globalThis.fetch = originalFetch;
      resetEnv();
    }
  });
});
