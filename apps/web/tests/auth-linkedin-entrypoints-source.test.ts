import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

const loginPageSource = fs.readFileSync(
  path.join(repoRoot, "src", "app", "auth", "login", "page.tsx"),
  "utf8",
);
const signupPageSource = fs.readFileSync(
  path.join(repoRoot, "src", "app", "auth", "signup", "page.tsx"),
  "utf8",
);
const loginClientSource = fs.readFileSync(
  path.join(repoRoot, "src", "app", "auth", "login", "LoginClient.tsx"),
  "utf8",
);
const signupClientSource = fs.readFileSync(
  path.join(repoRoot, "src", "app", "auth", "signup", "SignupClient.tsx"),
  "utf8",
);

test("login page passes LinkedIn login availability into the client", () => {
  assert.match(
    loginPageSource,
    /isLinkedInLoginEnabled/,
    "login page should use isLinkedInLoginEnabled (not connected accounts status)",
  );
  assert.match(
    loginPageSource,
    /<LoginClient[\s\S]*linkedinOauthAvailable=\{linkedinOauthAvailable\}/,
    "login page should pass LinkedIn availability into the client component",
  );
});

test("signup page passes LinkedIn login availability into the client", () => {
  assert.match(
    signupPageSource,
    /isLinkedInLoginEnabled/,
    "signup page should use isLinkedInLoginEnabled (not connected accounts status)",
  );
  assert.match(
    signupPageSource,
    /<SignupClient[\s\S]*linkedinOauthAvailable=\{linkedinOauthAvailable\}/,
    "signup page should pass LinkedIn availability into the client component",
  );
});

test("auth clients gate the LinkedIn CTA on integration availability", () => {
  assert.match(
    loginClientSource,
    /linkedinOauthAvailable && \(/,
    "login client should only render LinkedIn auth when integration is available",
  );
  assert.match(
    signupClientSource,
    /linkedinOauthAvailable && \(/,
    "signup client should only render LinkedIn auth when integration is available",
  );
  assert.match(
    loginClientSource,
    /const isSocialLoading = isGoogleLoading \|\| isLinkedInLoading;/,
    "login client should prevent concurrent social OAuth starts",
  );
  assert.match(
    signupClientSource,
    /const isSocialLoading = isGoogleLoading \|\| isLinkedInLoading;/,
    "signup client should prevent concurrent social OAuth starts",
  );
});
