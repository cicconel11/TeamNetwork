import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canRenderAsIframe, isHttpsUrl, isStripeFamilyHost } from "../src/lib/security/embed-url-policy";

describe("embed-url-policy", () => {
  it("accepts valid https URLs", () => {
    assert.equal(isHttpsUrl("https://example.com/page"), true);
  });

  it("rejects non-https URLs", () => {
    assert.equal(isHttpsUrl("http://example.com/page"), false);
  });

  it("identifies stripe family hosts", () => {
    assert.equal(isStripeFamilyHost("stripe.com"), true);
    assert.equal(isStripeFamilyHost("connect.stripe.com"), true);
    assert.equal(isStripeFamilyHost("docs.stripe.com"), true);
    assert.equal(isStripeFamilyHost("example.com"), false);
  });

  it("blocks iframe rendering for stripe domains", () => {
    const result = canRenderAsIframe("https://connect.stripe.com/setup");
    assert.equal(result.ok, false);
    assert.equal(
      result.reason,
      "Stripe pages cannot be embedded in iframes due to Stripe security policy. Use Link mode instead.",
    );
  });

  it("allows iframe rendering for non-stripe https domains", () => {
    const result = canRenderAsIframe("https://fundraising.example.org/campaign");
    assert.equal(result.ok, true);
  });
});
