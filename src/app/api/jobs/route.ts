import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createJobSchema } from "@/lib/schemas/jobs";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { linkMediaToEntity } from "@/lib/media/link";
import { fetchMediaForEntities } from "@/lib/media/fetch";

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

    // Fetch media attachments for all jobs
    const jobIds = activeJobs.map(j => j.id);
    const serviceClient = createServiceClient();
    const mediaMap = jobIds.length > 0
      ? await fetchMediaForEntities(serviceClient, "job_posting", jobIds)
      : new Map();

    // Augment jobs with media
    const augmentedJobs = activeJobs.map(job => ({
      ...job,
      media: mediaMap.get(job.id) ?? [],
    }));

    return NextResponse.json(
      {
        jobs: augmentedJobs,
        pagination: {
          page,
          limit,
          total: augmentedJobs.length,
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
    const { orgId, mediaIds, ...jobFields } = body;

    if (!orgId) {
      return NextResponse.json({ error: "orgId is required" }, { status: 400 });
    }

    // Validate job fields (mediaIds handled separately below)
    const validationResult = createJobSchema.safeParse({ ...jobFields, mediaIds });
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

    // Fetch configurable job posting roles from the org
    const { data: org } = await supabase
      .from("organizations")
      .select("job_post_roles")
      .eq("id", orgId)
      .maybeSingle();

    const allowedRoles = (org as Record<string, unknown> | null)?.job_post_roles as string[] || ["admin", "alumni"];
    if (!allowedRoles.includes(membership.role)) {
      return NextResponse.json(
        { error: "You do not have permission to post jobs" },
        { status: 403 }
      );
    }

    // Create job posting (exclude mediaIds from DB insert)
    const { mediaIds: validatedMediaIds, ...jobInsertData } = validationResult.data;
    const { data: job, error } = await supabase
      .from("job_postings")
      .insert({
        organization_id: orgId,
        posted_by: user.id,
        ...jobInsertData,
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
    }

    // Link media attachments if provided
    if (validatedMediaIds && validatedMediaIds.length > 0) {
      const serviceClient = createServiceClient();
      const linkResult = await linkMediaToEntity(serviceClient, {
        mediaIds: validatedMediaIds,
        entityType: "job_posting",
        entityId: job.id,
        orgId,
        userId: user.id,
      });
      if (linkResult.error) {
        // Clean up orphaned job posting to prevent duplicates on retry
        await serviceClient.from("job_postings").update({ deleted_at: new Date().toISOString() }).eq("id", job.id);
        return NextResponse.json({ error: linkResult.error }, { status: 400, headers: rateLimit.headers });
      }
    }

    return NextResponse.json({ job }, { status: 201, headers: rateLimit.headers });
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
