import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createJobSchema } from "@/lib/schemas/jobs";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";

export async function GET(request: NextRequest) {
  try {
    // Rate limit check BEFORE auth
    const rateLimit = checkRateLimit(request, {
      feature: "jobs list",
      limitPerIp: 60,
      limitPerUser: 45,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("orgId");
    const pageParam = searchParams.get("page");
    const limitParam = searchParams.get("limit");

    if (!orgId) {
      return NextResponse.json({ error: "orgId is required" }, { status: 400 });
    }

    // Parse pagination params
    const page = Math.max(1, parseInt(pageParam || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(limitParam || "20", 10)));
    const offset = (page - 1) * limit;

    // Check user is a member of the organization
    const membership = await getOrgMembership(supabase, user.id, orgId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    // Fetch active, non-deleted jobs with pagination
    const { data: jobs, error } = await supabase
      .from("job_postings")
      .select("*, users!job_postings_posted_by_fkey(name)")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
    }

    // Filter out expired jobs (client-side filtering after DB query)
    const now = new Date();
    const activeJobs = (jobs || []).filter(job => {
      if (!job.expires_at) return true;
      return new Date(job.expires_at) > now;
    });

    return NextResponse.json(
      {
        jobs: activeJobs,
        pagination: {
          page,
          limit,
          total: activeJobs.length,
        },
      },
      { headers: rateLimit.headers },
    );
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit check AFTER auth for mutations
    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      feature: "create job",
      limitPerIp: 10,
      limitPerUser: 5,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const body = await request.json();
    const { orgId, ...jobFields } = body;

    if (!orgId) {
      return NextResponse.json({ error: "orgId is required" }, { status: 400 });
    }

    // Validate job fields
    const validationResult = createJobSchema.safeParse(jobFields);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Validation failed", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    // Check user is alumni or admin
    const membership = await getOrgMembership(supabase, user.id, orgId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const isAlumniOrAdmin = membership.role === "admin" || membership.role === "alumni";
    if (!isAlumniOrAdmin) {
      return NextResponse.json(
        { error: "Only alumni and admins can post jobs" },
        { status: 403 }
      );
    }

    // Create job posting
    const { data: job, error } = await supabase
      .from("job_postings")
      .insert({
        organization_id: orgId,
        posted_by: user.id,
        ...validationResult.data,
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
    }

    return NextResponse.json({ job }, { status: 201, headers: rateLimit.headers });
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
