import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createJobSchema } from "@/lib/schemas/jobs";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    // Rate limit check BEFORE auth
    const rateLimit = checkRateLimit(request, {
      feature: "job detail",
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

    const { jobId } = await params;

    const { data: job, error } = await supabase
      .from("job_postings")
      .select("*, users!job_postings_posted_by_fkey(name, email)")
      .eq("id", jobId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {

      return NextResponse.json({ error: "Failed to fetch job" }, { status: 500 });
    }

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Check user is a member of the organization
    const membership = await getOrgMembership(supabase, user.id, job.organization_id);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    return NextResponse.json({ job }, { headers: rateLimit.headers });
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit check AFTER auth for mutations
    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      feature: "update job",
      limitPerIp: 30,
      limitPerUser: 15,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const { jobId } = await params;
    const body = await request.json();

    // Validate job fields
    const validationResult = createJobSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Validation failed", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    // Fetch existing job
    const { data: existingJob, error: fetchError } = await supabase
      .from("job_postings")
      .select("organization_id, posted_by")
      .eq("id", jobId)
      .is("deleted_at", null)
      .maybeSingle();

    if (fetchError) {

      return NextResponse.json({ error: "Failed to fetch job" }, { status: 500 });
    }

    if (!existingJob) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Check user is the author or an admin
    const isAuthor = existingJob.posted_by === user.id;
    const membership = await getOrgMembership(supabase, user.id, existingJob.organization_id);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const isAdmin = membership.role === "admin";

    if (!isAuthor && !isAdmin) {
      return NextResponse.json(
        { error: "Only the job author or admins can edit this job" },
        { status: 403 }
      );
    }

    // Update job
    const { data: job, error } = await supabase
      .from("job_postings")
      .update({
        ...validationResult.data,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to update job" }, { status: 500 });
    }

    return NextResponse.json({ job }, { headers: rateLimit.headers });
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit check AFTER auth for mutations
    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      feature: "delete job",
      limitPerIp: 30,
      limitPerUser: 15,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const { jobId } = await params;

    // Fetch existing job
    const { data: existingJob, error: fetchError } = await supabase
      .from("job_postings")
      .select("organization_id, posted_by")
      .eq("id", jobId)
      .is("deleted_at", null)
      .maybeSingle();

    if (fetchError) {

      return NextResponse.json({ error: "Failed to fetch job" }, { status: 500 });
    }

    if (!existingJob) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Check user is the author or an admin
    const isAuthor = existingJob.posted_by === user.id;
    const membership = await getOrgMembership(supabase, user.id, existingJob.organization_id);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const isAdmin = membership.role === "admin";

    if (!isAuthor && !isAdmin) {
      return NextResponse.json(
        { error: "Only the job author or admins can delete this job" },
        { status: 403 }
      );
    }

    // Soft delete
    const { error } = await supabase
      .from("job_postings")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", jobId);

    if (error) {
      return NextResponse.json({ error: "Failed to delete job" }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { headers: rateLimit.headers });
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
