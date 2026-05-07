import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getStripeOrigin } from "../src/lib/stripe-origin";

const REQ_URL = "https://teammeet-abc.vercel.app/api/stripe/create-org-checkout";
const FALLBACK = "https://teammeet-abc.vercel.app";

describe("getStripeOrigin — validates and normalizes NEXT_PUBLIC_SITE_URL", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.NEXT_PUBLIC_SITE_URL;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = savedEnv;
    }
  });

  // --- happy path ---

  it("passes through a valid https URL unchanged", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.myteamnetwork.com";
    assert.equal(getStripeOrigin(REQ_URL), "https://www.myteamnetwork.com");
  });

  it("passes through a valid http URL (dev)", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    assert.equal(getStripeOrigin(REQ_URL), "http://localhost:3000");
  });

  // --- whitespace / newline trimming ---

  it("reproduces the bug: trailing newline in env var is trimmed", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.myteamnetwork.com\n";
    assert.equal(getStripeOrigin(REQ_URL), "https://www.myteamnetwork.com");
  });

  it("trims surrounding whitespace", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "  https://www.myteamnetwork.com  ";
    assert.equal(getStripeOrigin(REQ_URL), "https://www.myteamnetwork.com");
  });

  it("strips trailing path/slash via URL.origin normalization", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.myteamnetwork.com/";
    assert.equal(getStripeOrigin(REQ_URL), "https://www.myteamnetwork.com");
  });

  // --- missing protocol fallback ---

  it("adds https:// when protocol is missing (hostname-like input)", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "www.myteamnetwork.com";
    assert.equal(getStripeOrigin(REQ_URL), "https://www.myteamnetwork.com");
  });

  // --- non-HTTP schemes rejected ---

  it("rejects localhost:3000 without protocol (parsed as scheme localhost:)", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "localhost:3000";
    assert.equal(getStripeOrigin(REQ_URL), FALLBACK);
  });

  it("rejects javascript: scheme", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "javascript:alert(1)";
    assert.equal(getStripeOrigin(REQ_URL), FALLBACK);
  });

  it("rejects mailto: scheme", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "mailto:test@example.com";
    assert.equal(getStripeOrigin(REQ_URL), FALLBACK);
  });

  it("rejects ftp:// scheme", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "ftp://example.com";
    assert.equal(getStripeOrigin(REQ_URL), FALLBACK);
  });

  it("rejects protocol-relative //evil.example.com", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "//evil.example.com";
    assert.equal(getStripeOrigin(REQ_URL), FALLBACK);
  });

  // --- empty / unset / invalid ---

  it("falls back to reqUrl origin when env var is empty string", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "";
    assert.equal(getStripeOrigin(REQ_URL), FALLBACK);
  });

  it("falls back to reqUrl origin when env var is whitespace-only", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "   ";
    assert.equal(getStripeOrigin(REQ_URL), FALLBACK);
  });

  it("falls back to reqUrl origin when env var is unset", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    assert.equal(getStripeOrigin(REQ_URL), FALLBACK);
  });

  it("falls back to reqUrl for completely invalid env var", () => {
    process.env.NEXT_PUBLIC_SITE_URL = ":::not a url:::";
    assert.equal(getStripeOrigin(REQ_URL), FALLBACK);
  });
});
