/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { fetchMediaForEntities } from "@/lib/media/fetch";
import { CACHE_HEADERS } from "@/lib/api/response";
import { createJobPosting } from "@/lib/jobs/create-job";

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

    // Fetch active, non-deleted, non-expired jobs with pagination
    const { data: jobs, error, count } = await supabase
      .from("job_postings")
      .select("*, users!job_postings_posted_by_fkey(name)", { count: "exact" })
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .or("expires_at.is.null,expires_at.gt.now()")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
    }

    // Fetch media attachments for all jobs
    const jobIds = (jobs || []).map(j => j.id);
    const serviceClient = createServiceClient();
    const mediaMap = jobIds.length > 0
      ? await fetchMediaForEntities(serviceClient, "job_posting", jobIds)
      : new Map();

    // Augment jobs with media
    const augmentedJobs = (jobs || []).map(job => ({
      ...job,
      media: mediaMap.get(job.id) ?? [],
    }));

    return NextResponse.json(
      {
        jobs: augmentedJobs,
        pagination: {
          page,
          limit,
          total: count ?? 0,
        },
      },
      { headers: { ...rateLimit.headers, ...CACHE_HEADERS.privateShort } },
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
    const { orgId, ...jobInput } = body;

    if (!orgId) {
      return NextResponse.json({ error: "orgId is required" }, { status: 400 });
    }

    const result = await createJobPosting({
      supabase,
      serviceSupabase: createServiceClient(),
      orgId,
      userId: user.id,
      input: jobInput,
    });

    if (!result.ok) {
      return NextResponse.json(
        result.details ? { error: result.error, details: result.details } : { error: result.error },
        { status: result.status, headers: rateLimit.headers }
      );
    }

    return NextResponse.json({ job: result.job }, { status: result.status, headers: rateLimit.headers });
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
