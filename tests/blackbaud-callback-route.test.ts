import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("blackbaud callback scopes the atomic oauth-state claim to the authenticated user", () => {
  const routePath = new URL("../src/app/api/blackbaud/callback/route.ts", import.meta.url);
  const routeCode = fs.readFileSync(routePath, "utf8");

  assert.match(
    routeCode,
    /\.from\("org_integration_oauth_state"\)[\s\S]+?\.eq\("used", false\)[\s\S]+?\.eq\("user_id", user\.id\)[\s\S]+?\.select\("id, organization_id, provider, user_id, redirect_path, initiated_at, used"\)/,
    "callback must include the authenticated user in the atomic OAuth state-claim query before selecting the claimed row",
  );
});
