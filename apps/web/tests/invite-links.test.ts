import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildInviteLink } from "@/lib/invites/buildInviteLink";

describe("buildInviteLink", () => {
  it("builds parent invite link with org and code", () => {
    const url = buildInviteLink({
      kind: "parent",
      baseUrl: "https://example.com",
      orgId: "org-123",
      code: "PARENTCODE",
    });

    assert.equal(url, "https://example.com/app/parents-join?org=org-123&code=PARENTCODE");
  });

  it("builds org invite link preferring token", () => {
    const url = buildInviteLink({
      kind: "org",
      baseUrl: "https://example.com",
      token: "secure-token",
      code: "fallback",
    });

    assert.equal(url, "https://example.com/app/join?token=secure-token");
  });
});
