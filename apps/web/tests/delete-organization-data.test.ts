/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert";

function seedStripeEnv() {
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "sk_test_dummy";
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "pk_test_dummy";
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "anon_dummy";
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "service_dummy";

  const priceIds = {
    STRIPE_PRICE_BASE_MONTHLY: "price_base_monthly",
    STRIPE_PRICE_BASE_YEARLY: "price_base_yearly",
    STRIPE_PRICE_ALUMNI_0_250_MONTHLY: "price_alumni_0_250_monthly",
    STRIPE_PRICE_ALUMNI_0_250_YEARLY: "price_alumni_0_250_yearly",
    STRIPE_PRICE_ALUMNI_251_500_MONTHLY: "price_alumni_251_500_monthly",
    STRIPE_PRICE_ALUMNI_251_500_YEARLY: "price_alumni_251_500_yearly",
    STRIPE_PRICE_ALUMNI_501_1000_MONTHLY: "price_alumni_501_1000_monthly",
    STRIPE_PRICE_ALUMNI_501_1000_YEARLY: "price_alumni_501_1000_yearly",
    STRIPE_PRICE_ALUMNI_1001_2500_MONTHLY: "price_alumni_1001_2500_monthly",
    STRIPE_PRICE_ALUMNI_1001_2500_YEARLY: "price_alumni_1001_2500_yearly",
    STRIPE_PRICE_ALUMNI_2500_5000_MONTHLY: "price_alumni_2500_5000_monthly",
    STRIPE_PRICE_ALUMNI_2500_5000_YEARLY: "price_alumni_2500_5000_yearly",
  } as const;

  for (const [key, value] of Object.entries(priceIds)) {
    process.env[key] = process.env[key] ?? value;
  }
}

async function loadDeleteOrganizationData() {
  seedStripeEnv();
  const mod = await import("../src/lib/subscription/delete-organization.ts");
  return mod.deleteOrganizationData as (db: any, organizationId: string) => Promise<void>;
}

describe("deleteOrganizationData", () => {
  it("includes legacy donations and excludes obsolete form_responses", async () => {
    const deleteOrganizationData = await loadDeleteOrganizationData();
    const touchedTables: string[] = [];

    const db = {
      from(table: string) {
        touchedTables.push(table);
        return {
          delete() {
            return {
              async eq() {
                return { error: null };
              },
            };
          },
        };
      },
    };

    await deleteOrganizationData(db as any, "org_123");

    assert.ok(touchedTables.includes("donations"), "expected legacy donations table to be deleted");
    assert.ok(!touchedTables.includes("form_responses"), "did not expect obsolete form_responses table");
  });

  it("throws if any table delete fails", async () => {
    const deleteOrganizationData = await loadDeleteOrganizationData();

    const db = {
      from(table: string) {
        return {
          delete() {
            return {
              async eq() {
                if (table === "organization_donations") {
                  return { error: { message: "boom" } };
                }
                return { error: null };
              },
            };
          },
        };
      },
    };

    await assert.rejects(
      () => deleteOrganizationData(db as any, "org_123"),
      /boom/
    );
  });
});
