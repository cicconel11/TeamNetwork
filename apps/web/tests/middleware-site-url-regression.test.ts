import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { validateSiteUrl } from "../src/lib/supabase/config";

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("validateSiteUrl rejects non-canonical NEXT_PUBLIC_SITE_URL in Vercel production", () => {
  assert.throws(
    () =>
      validateSiteUrl({
        NODE_ENV: "production",
        VERCEL: "1",
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SITE_URL: "https://preview.myteamnetwork.com",
      } as NodeJS.ProcessEnv),
    /must use the canonical production origin/i
  );
});

test("middleware no longer limits site URL validation to /auth routes", () => {
  const middlewareSource = read("src/middleware.ts");

  assert.match(middlewareSource, /validateSiteUrl\(\);/);
  assert.ok(
    !middlewareSource.includes('if (pathname.startsWith("/auth/"))'),
    "Expected middleware to fail fast for non-auth routes that depend on NEXT_PUBLIC_SITE_URL"
  );
});
