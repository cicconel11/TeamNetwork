import test from "node:test";
import assert from "node:assert/strict";
import { isAnonymousFrictionAllowed } from "@/lib/feedback/anonymous-friction";

test("login_error allows anonymous friction feedback", () => {
  assert.equal(isAnonymousFrictionAllowed("login", "login_error"), true);
});

test("signup and age_gate errors allow anonymous", () => {
  assert.equal(isAnonymousFrictionAllowed("signup", "signup_error"), true);
  assert.equal(isAnonymousFrictionAllowed("signup", "age_gate_error"), true);
});

test("authenticated-only flows do not allow anonymous by default", () => {
  assert.equal(isAnonymousFrictionAllowed("join-org", "invite_error"), false);
  assert.equal(isAnonymousFrictionAllowed("create-org", "checkout_error"), false);
});
