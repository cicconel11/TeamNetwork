import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createOrgV2Schema,
  createEnterpriseV2Schema,
} from "@/lib/schemas/organization-v2";

const validOrg = {
  name: "Test Org",
  slug: "test-org",
  description: "An org",
  primaryColor: "#1e3a5f",
  billingInterval: "month" as const,
  actives: 100,
  alumni: 500,
};

const validEnt = {
  ...validOrg,
  subOrgs: 5,
  billingContactEmail: "billing@example.com",
};

describe("createOrgV2Schema", () => {
  it("accepts minimal valid payload", () => {
    const r = createOrgV2Schema.safeParse(validOrg);
    assert.ok(r.success);
  });

  it("accepts zero actives + zero alumni (route handles totalCents)", () => {
    const r = createOrgV2Schema.safeParse({ ...validOrg, actives: 0, alumni: 0 });
    assert.ok(r.success);
  });

  it("rejects missing actives", () => {
    const { actives: _drop, ...rest } = validOrg;
    void _drop;
    const r = createOrgV2Schema.safeParse(rest);
    assert.ok(!r.success);
  });

  it("rejects actives over cap", () => {
    const r = createOrgV2Schema.safeParse({ ...validOrg, actives: 2_000_000 });
    assert.ok(!r.success);
  });

  it("rejects negative alumni", () => {
    const r = createOrgV2Schema.safeParse({ ...validOrg, alumni: -1 });
    assert.ok(!r.success);
  });

  it("rejects bad slug", () => {
    const r = createOrgV2Schema.safeParse({ ...validOrg, slug: "Bad Slug!" });
    assert.ok(!r.success);
  });

  it("rejects bad hex color", () => {
    const r = createOrgV2Schema.safeParse({ ...validOrg, primaryColor: "blue" });
    assert.ok(!r.success);
  });

  it("rejects unknown fields (strict)", () => {
    const r = createOrgV2Schema.safeParse({ ...validOrg, monthlyCents: 9999 });
    assert.ok(!r.success);
  });

  it("accepts optional idempotencyKey", () => {
    const r = createOrgV2Schema.safeParse({
      ...validOrg,
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });
    assert.ok(r.success);
  });
});

describe("createEnterpriseV2Schema", () => {
  it("accepts minimal valid enterprise payload", () => {
    const r = createEnterpriseV2Schema.safeParse(validEnt);
    assert.ok(r.success);
  });

  it("rejects subOrgs over cap", () => {
    const r = createEnterpriseV2Schema.safeParse({ ...validEnt, subOrgs: 1_001 });
    assert.ok(!r.success);
  });

  it("rejects bad billing email", () => {
    const r = createEnterpriseV2Schema.safeParse({
      ...validEnt,
      billingContactEmail: "not-an-email",
    });
    assert.ok(!r.success);
  });

  it("rejects missing subOrgs", () => {
    const { subOrgs: _drop, ...rest } = validEnt;
    void _drop;
    const r = createEnterpriseV2Schema.safeParse(rest);
    assert.ok(!r.success);
  });
});
