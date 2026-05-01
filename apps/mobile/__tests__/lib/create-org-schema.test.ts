import { createOrgSchema } from "@teammeet/validation";

describe("createOrgSchema (mobile)", () => {
  const valid = {
    name: "Stanford Crew",
    slug: "stanford-crew",
    description: "A rowing club.",
    primaryColor: "#1e3a5f",
    billingInterval: "month" as const,
    alumniBucket: "none" as const,
    withTrial: false,
  };

  it("accepts a valid payload", () => {
    expect(createOrgSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = createOrgSchema.safeParse({ ...valid, name: "" });
    expect(result.success).toBe(false);
  });

  it("normalizes uppercase slugs to lowercase", () => {
    const result = createOrgSchema.safeParse({ ...valid, slug: "Stanford" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.slug).toBe("stanford");
  });

  it("rejects slugs with disallowed characters", () => {
    const result = createOrgSchema.safeParse({
      ...valid,
      slug: "stanford crew!",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-hex primary color", () => {
    const result = createOrgSchema.safeParse({
      ...valid,
      primaryColor: "navy",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown alumni bucket", () => {
    const result = createOrgSchema.safeParse({
      ...valid,
      alumniBucket: "10000+" as never,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown billing interval", () => {
    const result = createOrgSchema.safeParse({
      ...valid,
      billingInterval: "weekly" as never,
    });
    expect(result.success).toBe(false);
  });

  it("treats description as optional", () => {
    const { description: _omit, ...withoutDescription } = valid;
    expect(createOrgSchema.safeParse(withoutDescription).success).toBe(true);
  });
});
