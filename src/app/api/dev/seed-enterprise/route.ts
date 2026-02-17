import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * DEV ONLY: Seeds a mock enterprise for the current user
 * POST /api/dev/seed-enterprise
 */
export async function POST() {
  // Only allow in development
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: "This endpoint is only available in development" },
      { status: 403 }
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const serviceSupabase = createServiceClient();

  try {
    // Check if mock enterprise already exists
    const { data: existing } = await serviceSupabase
      .from("enterprises")
      .select("id")
      .eq("slug", "mock-enterprise")
      .single();

    let enterpriseId: string;

    if (existing) {
      enterpriseId = existing.id;
    } else {
      // Create mock enterprise
      const { data: enterprise, error: createError } = await serviceSupabase
        .from("enterprises")
        .insert({
          name: "Mock Enterprise",
          slug: "mock-enterprise",
          description: "Development testing enterprise",
          billing_contact_email: user.email,
        })
        .select("id")
        .single();

      if (createError) {
        throw new Error(`Failed to create enterprise: ${createError.message}`);
      }

      enterpriseId = enterprise.id;

      // Create subscription
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (serviceSupabase as any)
        .from("enterprise_subscriptions")
        .insert({
          enterprise_id: enterpriseId,
          billing_interval: "year",
          alumni_bucket_quantity: 1,
          sub_org_quantity: 3,
          status: "active",
        });
    }

    // Check if user already has a role
    const { data: existingRole } = await serviceSupabase
      .from("user_enterprise_roles")
      .select("id")
      .eq("user_id", user.id)
      .eq("enterprise_id", enterpriseId)
      .single();

    if (!existingRole) {
      // Add user as owner
      const { error: roleError } = await serviceSupabase
        .from("user_enterprise_roles")
        .insert({
          user_id: user.id,
          enterprise_id: enterpriseId,
          role: "owner",
        });

      if (roleError) {
        throw new Error(`Failed to add role: ${roleError.message}`);
      }
    }

    // Verify data was created correctly (using service client)
    const { data: verifyEnterprise } = await serviceSupabase
      .from("enterprises")
      .select("id, name, slug")
      .eq("id", enterpriseId)
      .single();

    const { data: verifyRole } = await serviceSupabase
      .from("user_enterprise_roles")
      .select("id, user_id, enterprise_id, role")
      .eq("user_id", user.id)
      .eq("enterprise_id", enterpriseId)
      .single();

    // Also test with regular client (RLS) to see if user can access
    const { data: rlsTest, error: rlsError } = await supabase
      .from("user_enterprise_roles")
      .select(`
        role,
        enterprise:enterprises(id, name, slug)
      `)
      .eq("user_id", user.id);

    console.log("[seed-enterprise] Verification:", {
      verifyEnterprise,
      verifyRole,
      rlsTest,
      rlsError: rlsError?.message,
    });

    return NextResponse.json({
      success: true,
      message: "Mock enterprise created successfully",
      enterprise: {
        id: enterpriseId,
        slug: "mock-enterprise",
        name: "Mock Enterprise",
      },
      userRole: "owner",
      debug: {
        verifyEnterprise,
        verifyRole,
        rlsTest,
        rlsError: rlsError?.message,
      },
    });
  } catch (error) {
    console.error("Error seeding enterprise:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to seed enterprise" },
      { status: 500 }
    );
  }
}
