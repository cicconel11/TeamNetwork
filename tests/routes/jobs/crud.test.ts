import test from "node:test";
import assert from "node:assert";
import type { AuthContext } from "../../utils/authMock.ts";
import {
  createAuthContext,
  isAuthenticated,
  hasOrgMembership,
  isOrgAdmin,
  getOrgRole,
  AuthPresets,
} from "../../utils/authMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

/**
 * Tests for /api/jobs routes
 *
 * GET /api/jobs — List jobs for an organization
 * POST /api/jobs — Create a new job posting
 * GET /api/jobs/[jobId] — Get job details
 * PATCH /api/jobs/[jobId] — Edit a job posting
 * DELETE /api/jobs/[jobId] — Soft delete a job posting
 *
 * Authorization:
 * - List/Detail: Active org members
 * - Create: Alumni, admin, or viewer roles ONLY (active_member CANNOT post)
 * - Edit: Author OR admin
 * - Delete: Author OR admin
 */

// ─── Types ───────────────────────────────────────────────────────────────────

interface JobPostingRow {
  id: string;
  organization_id: string;
  posted_by: string;
  title: string;
  company: string;
  location: string | null;
  location_type: "remote" | "hybrid" | "onsite" | null;
  description: string;
  application_url: string | null;
  contact_email: string | null;
  is_active: boolean;
  expires_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface JobFormData {
  title?: string;
  company?: string;
  location?: string;
  location_type?: "remote" | "hybrid" | "onsite";
  description?: string;
  application_url?: string;
  contact_email?: string;
}

interface ListJobsRequest {
  auth: AuthContext;
  orgId?: string;
}

interface CreateJobRequest {
  auth: AuthContext;
  orgId: string;
  data: JobFormData;
}

interface GetJobRequest {
  auth: AuthContext;
  jobId: string;
}

interface UpdateJobRequest {
  auth: AuthContext;
  jobId: string;
  data: JobFormData;
}

interface DeleteJobRequest {
  auth: AuthContext;
  jobId: string;
}

interface JobResult {
  status: number;
  error?: string;
  jobs?: JobPostingRow[];
  job?: JobPostingRow;
  success?: boolean;
}

interface SimulationContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  organizationId: string;
}

// ─── Validation Helpers ──────────────────────────────────────────────────────

function validateJobData(data: JobFormData): { valid: boolean; error?: string } {
  // Title: required, 3-200 chars
  if (!data.title || data.title.trim().length === 0) {
    return { valid: false, error: "title is required" };
  }
  if (data.title.length < 3 || data.title.length > 200) {
    return { valid: false, error: "title must be 3-200 characters" };
  }

  // Company: required, 2-200 chars
  if (!data.company || data.company.trim().length === 0) {
    return { valid: false, error: "company is required" };
  }
  if (data.company.length < 2 || data.company.length > 200) {
    return { valid: false, error: "company must be 2-200 characters" };
  }

  // Description: required, 10-10000 chars
  if (!data.description || data.description.trim().length === 0) {
    return { valid: false, error: "description is required" };
  }
  if (data.description.length < 10 || data.description.length > 10000) {
    return { valid: false, error: "description must be 10-10000 characters" };
  }

  // Location: optional, max 200 chars
  if (data.location && data.location.length > 200) {
    return { valid: false, error: "location must be max 200 characters" };
  }

  // Location type: optional enum
  if (
    data.location_type &&
    !["remote", "hybrid", "onsite"].includes(data.location_type)
  ) {
    return { valid: false, error: "location_type must be remote, hybrid, or onsite" };
  }

  // Application URL: optional, must be valid HTTPS URL
  if (data.application_url) {
    try {
      const url = new URL(data.application_url);
      if (url.protocol !== "https:") {
        return { valid: false, error: "application_url must be HTTPS" };
      }
    } catch {
      return { valid: false, error: "application_url must be a valid URL" };
    }
  }

  // Contact email: optional, basic email validation
  if (data.contact_email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.contact_email)) {
      return { valid: false, error: "contact_email must be a valid email" };
    }
  }

  return { valid: true };
}

function canPostJobs(auth: AuthContext, organizationId: string): boolean {
  const role = getOrgRole(auth, organizationId);
  // Only alumni, admin, or viewer can post jobs
  // active_member is specifically DENIED
  return role === "alumni" || role === "admin";
}

// ─── Simulation Functions ────────────────────────────────────────────────────

function simulateListJobs(
  request: ListJobsRequest,
  ctx: SimulationContext
): JobResult {
  // Auth check
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // orgId required
  if (!request.orgId) {
    return { status: 400, error: "orgId is required" };
  }

  // Check org membership
  if (!hasOrgMembership(request.auth, request.orgId)) {
    return { status: 403, error: "Forbidden" };
  }

  // Fetch jobs
  const allJobs = ctx.supabase
    .getRows("job_postings") as JobPostingRow[];

  const now = new Date().toISOString();

  // Filter: org, active, not deleted, not expired
  const activeJobs = allJobs.filter(
    (job) =>
      job.organization_id === request.orgId &&
      job.is_active === true &&
      job.deleted_at === null &&
      (!job.expires_at || job.expires_at > now)
  );

  // Order by created_at DESC (most recent first)
  activeJobs.sort((a, b) => b.created_at.localeCompare(a.created_at));

  return { status: 200, jobs: activeJobs };
}

function simulateCreateJob(
  request: CreateJobRequest,
  ctx: SimulationContext
): JobResult {
  // Auth check
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // Validate body
  const validation = validateJobData(request.data);
  if (!validation.valid) {
    return { status: 400, error: validation.error };
  }

  // Check org membership
  if (!hasOrgMembership(request.auth, request.orgId)) {
    return { status: 403, error: "Forbidden" };
  }

  // Check role permission: only alumni, admin, viewer can post
  if (!canPostJobs(request.auth, request.orgId)) {
    return { status: 403, error: "Only alumni, admin, or viewer can post jobs" };
  }

  // Create job
  const now = new Date().toISOString();
  const job: JobPostingRow = {
    id: `job-${Date.now()}`,
    organization_id: request.orgId,
    posted_by: request.auth.user!.id,
    title: request.data.title!,
    company: request.data.company!,
    location: request.data.location || null,
    location_type: request.data.location_type || null,
    description: request.data.description!,
    application_url: request.data.application_url || null,
    contact_email: request.data.contact_email || null,
    is_active: true,
    expires_at: null,
    deleted_at: null,
    created_at: now,
    updated_at: now,
  };

  ctx.supabase.seed("job_postings", [job]);

  return { status: 201, job };
}

function simulateGetJob(
  request: GetJobRequest,
  ctx: SimulationContext
): JobResult {
  // Auth check
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // Fetch job
  const allJobs = ctx.supabase
    .getRows("job_postings") as JobPostingRow[];

  const job = allJobs.find(
    (j) => j.id === request.jobId && j.deleted_at === null
  );

  // 404 if not found or deleted
  if (!job) {
    return { status: 404, error: "Job not found" };
  }

  // Check org membership
  if (!hasOrgMembership(request.auth, job.organization_id)) {
    return { status: 403, error: "Forbidden" };
  }

  return { status: 200, job };
}

function simulateUpdateJob(
  request: UpdateJobRequest,
  ctx: SimulationContext
): JobResult {
  // Auth check
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // Validate body
  const validation = validateJobData(request.data);
  if (!validation.valid) {
    return { status: 400, error: validation.error };
  }

  // Fetch existing job
  const allJobs = ctx.supabase
    .getRows("job_postings") as JobPostingRow[];

  const job = allJobs.find(
    (j) => j.id === request.jobId && j.deleted_at === null
  );

  // 404 if not found
  if (!job) {
    return { status: 404, error: "Job not found" };
  }

  const userId = request.auth.user!.id;
  const isAuthor = job.posted_by === userId;
  const admin = isOrgAdmin(request.auth, job.organization_id);

  // Only author or admin can edit
  if (!isAuthor && !admin) {
    return { status: 403, error: "Forbidden" };
  }

  // Update job
  const updatedJob: JobPostingRow = {
    ...job,
    title: request.data.title!,
    company: request.data.company!,
    location: request.data.location || null,
    location_type: request.data.location_type || null,
    description: request.data.description!,
    application_url: request.data.application_url || null,
    contact_email: request.data.contact_email || null,
    updated_at: new Date().toISOString(),
  };

  // Update in stub
  ctx.supabase.clear("job_postings");
  ctx.supabase.seed(
    "job_postings",
    allJobs.map((j) => (j.id === request.jobId ? updatedJob : j))
  );

  return { status: 200, job: updatedJob };
}

function simulateDeleteJob(
  request: DeleteJobRequest,
  ctx: SimulationContext
): JobResult {
  // Auth check
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // Fetch existing job
  const allJobs = ctx.supabase
    .getRows("job_postings") as JobPostingRow[];

  const job = allJobs.find(
    (j) => j.id === request.jobId && j.deleted_at === null
  );

  // 404 if not found
  if (!job) {
    return { status: 404, error: "Job not found" };
  }

  const userId = request.auth.user!.id;
  const isAuthor = job.posted_by === userId;
  const admin = isOrgAdmin(request.auth, job.organization_id);

  // Only author or admin can delete
  if (!isAuthor && !admin) {
    return { status: 403, error: "Forbidden" };
  }

  // Soft delete: set deleted_at
  const deletedJob: JobPostingRow = {
    ...job,
    deleted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Update in stub
  ctx.supabase.clear("job_postings");
  ctx.supabase.seed(
    "job_postings",
    allJobs.map((j) => (j.id === request.jobId ? deletedJob : j))
  );

  return { status: 200, success: true };
}

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createTestContext(): SimulationContext {
  const supabase = createSupabaseStub();
  const organizationId = "org-1";

  // Seed user_organization_roles
  supabase.seed("user_organization_roles", [
    {
      id: "role-1",
      user_id: "admin-user",
      organization_id: organizationId,
      role: "admin",
      status: "active",
    },
    {
      id: "role-2",
      user_id: "member-user",
      organization_id: organizationId,
      role: "active_member",
      status: "active",
    },
    {
      id: "role-3",
      user_id: "alumni-user",
      organization_id: organizationId,
      role: "alumni",
      status: "active",
    },
  ]);

  return { supabase, organizationId };
}

const validJobData: JobFormData = {
  title: "Senior Software Engineer",
  company: "Tech Corp",
  description: "We are looking for an experienced engineer to join our team.",
  location: "New York, NY",
  location_type: "hybrid",
  application_url: "https://example.com/apply",
  contact_email: "jobs@example.com",
};

// ─── Tests: GET /api/jobs (List) ─────────────────────────────────────────────

test("GET /api/jobs - returns 401 when not authenticated", () => {
  const ctx = createTestContext();
  const result = simulateListJobs(
    { auth: AuthPresets.unauthenticated, orgId: ctx.organizationId },
    ctx
  );
  assert.strictEqual(result.status, 401);
});

test("GET /api/jobs - returns 400 when orgId missing", () => {
  const ctx = createTestContext();
  const result = simulateListJobs(
    { auth: AuthPresets.orgAdmin(), orgId: undefined },
    ctx
  );
  assert.strictEqual(result.status, 400);
});

test("GET /api/jobs - returns 403 when not org member", () => {
  const ctx = createTestContext();
  const result = simulateListJobs(
    { auth: AuthPresets.authenticatedNoOrg, orgId: ctx.organizationId },
    ctx
  );
  assert.strictEqual(result.status, 403);
});

test("GET /api/jobs - returns only active, non-deleted, non-expired jobs", () => {
  const ctx = createTestContext();

  // Seed various jobs
  ctx.supabase.seed("job_postings", [
    {
      id: "job-1",
      organization_id: ctx.organizationId,
      posted_by: "alumni-user",
      title: "Active Job",
      company: "Company A",
      description: "This is an active job",
      is_active: true,
      deleted_at: null,
      expires_at: null,
      created_at: "2026-02-10T00:00:00Z",
    },
    {
      id: "job-2",
      organization_id: ctx.organizationId,
      posted_by: "alumni-user",
      title: "Inactive Job",
      company: "Company B",
      description: "This is inactive",
      is_active: false,
      deleted_at: null,
      expires_at: null,
      created_at: "2026-02-11T00:00:00Z",
    },
    {
      id: "job-3",
      organization_id: ctx.organizationId,
      posted_by: "alumni-user",
      title: "Deleted Job",
      company: "Company C",
      description: "This is deleted",
      is_active: true,
      deleted_at: "2026-02-12T00:00:00Z",
      expires_at: null,
      created_at: "2026-02-12T00:00:00Z",
    },
  ]);

  const result = simulateListJobs(
    { auth: AuthPresets.orgMember(ctx.organizationId), orgId: ctx.organizationId },
    ctx
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.jobs!.length, 1);
  assert.strictEqual(result.jobs![0].id, "job-1");
});

test("GET /api/jobs - filters out expired jobs", () => {
  const ctx = createTestContext();

  const now = new Date();
  const future = new Date(now.getTime() + 86400000).toISOString(); // +1 day
  const past = new Date(now.getTime() - 86400000).toISOString(); // -1 day

  ctx.supabase.seed("job_postings", [
    {
      id: "job-future",
      organization_id: ctx.organizationId,
      posted_by: "alumni-user",
      title: "Future Expiry",
      company: "Company A",
      description: "Expires in the future",
      is_active: true,
      deleted_at: null,
      expires_at: future,
      created_at: "2026-02-10T00:00:00Z",
    },
    {
      id: "job-past",
      organization_id: ctx.organizationId,
      posted_by: "alumni-user",
      title: "Past Expiry",
      company: "Company B",
      description: "Already expired",
      is_active: true,
      deleted_at: null,
      expires_at: past,
      created_at: "2026-02-11T00:00:00Z",
    },
  ]);

  const result = simulateListJobs(
    { auth: AuthPresets.orgMember(ctx.organizationId), orgId: ctx.organizationId },
    ctx
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.jobs!.length, 1);
  assert.strictEqual(result.jobs![0].id, "job-future");
});

test("GET /api/jobs - orders by created_at DESC", () => {
  const ctx = createTestContext();

  ctx.supabase.seed("job_postings", [
    {
      id: "job-old",
      organization_id: ctx.organizationId,
      posted_by: "alumni-user",
      title: "Old Job",
      company: "Company A",
      description: "Created first",
      is_active: true,
      deleted_at: null,
      expires_at: null,
      created_at: "2026-02-01T00:00:00Z",
    },
    {
      id: "job-new",
      organization_id: ctx.organizationId,
      posted_by: "alumni-user",
      title: "New Job",
      company: "Company B",
      description: "Created later",
      is_active: true,
      deleted_at: null,
      expires_at: null,
      created_at: "2026-02-13T00:00:00Z",
    },
  ]);

  const result = simulateListJobs(
    { auth: AuthPresets.orgMember(ctx.organizationId), orgId: ctx.organizationId },
    ctx
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.jobs![0].id, "job-new");
  assert.strictEqual(result.jobs![1].id, "job-old");
});

// ─── Tests: POST /api/jobs (Create) ──────────────────────────────────────────

test("POST /api/jobs - returns 401 when not authenticated", () => {
  const ctx = createTestContext();
  const result = simulateCreateJob(
    {
      auth: AuthPresets.unauthenticated,
      orgId: ctx.organizationId,
      data: validJobData,
    },
    ctx
  );
  assert.strictEqual(result.status, 401);
});

test("POST /api/jobs - returns 400 on missing title", () => {
  const ctx = createTestContext();
  const result = simulateCreateJob(
    {
      auth: AuthPresets.orgAlumni(ctx.organizationId),
      orgId: ctx.organizationId,
      data: { ...validJobData, title: "" },
    },
    ctx
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("title"));
});

test("POST /api/jobs - returns 400 on short title", () => {
  const ctx = createTestContext();
  const result = simulateCreateJob(
    {
      auth: AuthPresets.orgAlumni(ctx.organizationId),
      orgId: ctx.organizationId,
      data: { ...validJobData, title: "AB" },
    },
    ctx
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("title"));
});

test("POST /api/jobs - returns 400 on missing company", () => {
  const ctx = createTestContext();
  const result = simulateCreateJob(
    {
      auth: AuthPresets.orgAlumni(ctx.organizationId),
      orgId: ctx.organizationId,
      data: { ...validJobData, company: "" },
    },
    ctx
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("company"));
});

test("POST /api/jobs - returns 400 on short description", () => {
  const ctx = createTestContext();
  const result = simulateCreateJob(
    {
      auth: AuthPresets.orgAlumni(ctx.organizationId),
      orgId: ctx.organizationId,
      data: { ...validJobData, description: "Too short" },
    },
    ctx
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("description"));
});

test("POST /api/jobs - returns 400 on invalid location_type", () => {
  const ctx = createTestContext();
  const result = simulateCreateJob(
    {
      auth: AuthPresets.orgAlumni(ctx.organizationId),
      orgId: ctx.organizationId,
      data: { ...validJobData, location_type: "invalid" as any },
    },
    ctx
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("location_type"));
});

test("POST /api/jobs - returns 400 on non-HTTPS application_url", () => {
  const ctx = createTestContext();
  const result = simulateCreateJob(
    {
      auth: AuthPresets.orgAlumni(ctx.organizationId),
      orgId: ctx.organizationId,
      data: { ...validJobData, application_url: "http://example.com" },
    },
    ctx
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("HTTPS"));
});

test("POST /api/jobs - returns 400 on invalid email", () => {
  const ctx = createTestContext();
  const result = simulateCreateJob(
    {
      auth: AuthPresets.orgAlumni(ctx.organizationId),
      orgId: ctx.organizationId,
      data: { ...validJobData, contact_email: "not-an-email" },
    },
    ctx
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("email"));
});

test("POST /api/jobs - returns 403 when active_member tries to post", () => {
  const ctx = createTestContext();
  const result = simulateCreateJob(
    {
      auth: AuthPresets.orgMember(ctx.organizationId),
      orgId: ctx.organizationId,
      data: validJobData,
    },
    ctx
  );
  assert.strictEqual(result.status, 403);
});

test("POST /api/jobs - returns 201 when alumni posts a job", () => {
  const ctx = createTestContext();
  const result = simulateCreateJob(
    {
      auth: AuthPresets.orgAlumni(ctx.organizationId),
      orgId: ctx.organizationId,
      data: validJobData,
    },
    ctx
  );
  assert.strictEqual(result.status, 201);
  assert.ok(result.job);
  assert.strictEqual(result.job.title, validJobData.title);
  assert.strictEqual(result.job.posted_by, "alumni-user");
});

test("POST /api/jobs - returns 201 when admin posts a job", () => {
  const ctx = createTestContext();
  const result = simulateCreateJob(
    {
      auth: AuthPresets.orgAdmin(ctx.organizationId),
      orgId: ctx.organizationId,
      data: validJobData,
    },
    ctx
  );
  assert.strictEqual(result.status, 201);
  assert.ok(result.job);
  assert.strictEqual(result.job.posted_by, "admin-user");
});

test("POST /api/jobs - sets correct posted_by from auth user", () => {
  const ctx = createTestContext();
  const result = simulateCreateJob(
    {
      auth: AuthPresets.orgAlumni(ctx.organizationId),
      orgId: ctx.organizationId,
      data: validJobData,
    },
    ctx
  );
  assert.strictEqual(result.status, 201);
  assert.strictEqual(result.job!.posted_by, "alumni-user");
});

// ─── Tests: GET /api/jobs/[jobId] (Detail) ───────────────────────────────────

test("GET /api/jobs/[jobId] - returns 401 when not authenticated", () => {
  const ctx = createTestContext();
  const result = simulateGetJob(
    { auth: AuthPresets.unauthenticated, jobId: "job-1" },
    ctx
  );
  assert.strictEqual(result.status, 401);
});

test("GET /api/jobs/[jobId] - returns 404 for non-existent job", () => {
  const ctx = createTestContext();
  const result = simulateGetJob(
    { auth: AuthPresets.orgMember(ctx.organizationId), jobId: "nonexistent" },
    ctx
  );
  assert.strictEqual(result.status, 404);
});

test("GET /api/jobs/[jobId] - returns 404 for deleted job", () => {
  const ctx = createTestContext();

  ctx.supabase.seed("job_postings", [
    {
      id: "job-deleted",
      organization_id: ctx.organizationId,
      posted_by: "alumni-user",
      title: "Deleted Job",
      company: "Company A",
      description: "This was deleted",
      is_active: true,
      deleted_at: "2026-02-12T00:00:00Z",
      expires_at: null,
      created_at: "2026-02-10T00:00:00Z",
    },
  ]);

  const result = simulateGetJob(
    { auth: AuthPresets.orgMember(ctx.organizationId), jobId: "job-deleted" },
    ctx
  );
  assert.strictEqual(result.status, 404);
});

test("GET /api/jobs/[jobId] - returns 403 when not org member", () => {
  const ctx = createTestContext();

  ctx.supabase.seed("job_postings", [
    {
      id: "job-1",
      organization_id: ctx.organizationId,
      posted_by: "alumni-user",
      title: "Job Title",
      company: "Company A",
      description: "Job description here",
      is_active: true,
      deleted_at: null,
      expires_at: null,
      created_at: "2026-02-10T00:00:00Z",
    },
  ]);

  const result = simulateGetJob(
    { auth: AuthPresets.authenticatedNoOrg, jobId: "job-1" },
    ctx
  );
  assert.strictEqual(result.status, 403);
});

test("GET /api/jobs/[jobId] - returns job details when authorized", () => {
  const ctx = createTestContext();

  ctx.supabase.seed("job_postings", [
    {
      id: "job-1",
      organization_id: ctx.organizationId,
      posted_by: "alumni-user",
      title: "Software Engineer",
      company: "Tech Corp",
      description: "Great opportunity",
      is_active: true,
      deleted_at: null,
      expires_at: null,
      created_at: "2026-02-10T00:00:00Z",
    },
  ]);

  const result = simulateGetJob(
    { auth: AuthPresets.orgMember(ctx.organizationId), jobId: "job-1" },
    ctx
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.job);
  assert.strictEqual(result.job.id, "job-1");
  assert.strictEqual(result.job.title, "Software Engineer");
});

// ─── Tests: PATCH /api/jobs/[jobId] (Edit) ──────────────────────────────────

test("PATCH /api/jobs/[jobId] - returns 401 when not authenticated", () => {
  const ctx = createTestContext();
  const result = simulateUpdateJob(
    {
      auth: AuthPresets.unauthenticated,
      jobId: "job-1",
      data: validJobData,
    },
    ctx
  );
  assert.strictEqual(result.status, 401);
});

test("PATCH /api/jobs/[jobId] - returns 400 on invalid body", () => {
  const ctx = createTestContext();

  ctx.supabase.seed("job_postings", [
    {
      id: "job-1",
      organization_id: ctx.organizationId,
      posted_by: "alumni-user",
      title: "Original Title",
      company: "Company A",
      description: "Original description",
      is_active: true,
      deleted_at: null,
      expires_at: null,
      created_at: "2026-02-10T00:00:00Z",
    },
  ]);

  const result = simulateUpdateJob(
    {
      auth: AuthPresets.orgAlumni(ctx.organizationId),
      jobId: "job-1",
      data: { ...validJobData, title: "" },
    },
    ctx
  );
  assert.strictEqual(result.status, 400);
});

test("PATCH /api/jobs/[jobId] - returns 404 for non-existent job", () => {
  const ctx = createTestContext();
  const result = simulateUpdateJob(
    {
      auth: AuthPresets.orgAlumni(ctx.organizationId),
      jobId: "nonexistent",
      data: validJobData,
    },
    ctx
  );
  assert.strictEqual(result.status, 404);
});

test("PATCH /api/jobs/[jobId] - returns 403 when not author and not admin", () => {
  const ctx = createTestContext();

  // Create job by alumni-user
  ctx.supabase.seed("job_postings", [
    {
      id: "job-1",
      organization_id: ctx.organizationId,
      posted_by: "alumni-user",
      title: "Original Title",
      company: "Company A",
      description: "Original description",
      is_active: true,
      deleted_at: null,
      expires_at: null,
      created_at: "2026-02-10T00:00:00Z",
    },
  ]);

  // Try to edit as different user (member-user)
  const result = simulateUpdateJob(
    {
      auth: AuthPresets.orgMember(ctx.organizationId),
      jobId: "job-1",
      data: validJobData,
    },
    ctx
  );
  assert.strictEqual(result.status, 403);
});

test("PATCH /api/jobs/[jobId] - author can edit their own job", () => {
  const ctx = createTestContext();

  ctx.supabase.seed("job_postings", [
    {
      id: "job-1",
      organization_id: ctx.organizationId,
      posted_by: "alumni-user",
      title: "Original Title",
      company: "Company A",
      description: "Original description",
      is_active: true,
      deleted_at: null,
      expires_at: null,
      created_at: "2026-02-10T00:00:00Z",
    },
  ]);

  const result = simulateUpdateJob(
    {
      auth: AuthPresets.orgAlumni(ctx.organizationId),
      jobId: "job-1",
      data: { ...validJobData, title: "Updated Title" },
    },
    ctx
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.job!.title, "Updated Title");
});

test("PATCH /api/jobs/[jobId] - admin can edit any job", () => {
  const ctx = createTestContext();

  ctx.supabase.seed("job_postings", [
    {
      id: "job-1",
      organization_id: ctx.organizationId,
      posted_by: "alumni-user",
      title: "Original Title",
      company: "Company A",
      description: "Original description",
      is_active: true,
      deleted_at: null,
      expires_at: null,
      created_at: "2026-02-10T00:00:00Z",
    },
  ]);

  const result = simulateUpdateJob(
    {
      auth: AuthPresets.orgAdmin(ctx.organizationId),
      jobId: "job-1",
      data: { ...validJobData, title: "Admin Updated" },
    },
    ctx
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.job!.title, "Admin Updated");
});

// ─── Tests: DELETE /api/jobs/[jobId] (Delete) ────────────────────────────────

test("DELETE /api/jobs/[jobId] - returns 401 when not authenticated", () => {
  const ctx = createTestContext();
  const result = simulateDeleteJob(
    { auth: AuthPresets.unauthenticated, jobId: "job-1" },
    ctx
  );
  assert.strictEqual(result.status, 401);
});

test("DELETE /api/jobs/[jobId] - returns 404 for non-existent job", () => {
  const ctx = createTestContext();
  const result = simulateDeleteJob(
    { auth: AuthPresets.orgAlumni(ctx.organizationId), jobId: "nonexistent" },
    ctx
  );
  assert.strictEqual(result.status, 404);
});

test("DELETE /api/jobs/[jobId] - returns 403 when not author and not admin", () => {
  const ctx = createTestContext();

  ctx.supabase.seed("job_postings", [
    {
      id: "job-1",
      organization_id: ctx.organizationId,
      posted_by: "alumni-user",
      title: "Job Title",
      company: "Company A",
      description: "Job description",
      is_active: true,
      deleted_at: null,
      expires_at: null,
      created_at: "2026-02-10T00:00:00Z",
    },
  ]);

  const result = simulateDeleteJob(
    { auth: AuthPresets.orgMember(ctx.organizationId), jobId: "job-1" },
    ctx
  );
  assert.strictEqual(result.status, 403);
});

test("DELETE /api/jobs/[jobId] - author can delete their own job", () => {
  const ctx = createTestContext();

  ctx.supabase.seed("job_postings", [
    {
      id: "job-1",
      organization_id: ctx.organizationId,
      posted_by: "alumni-user",
      title: "Job Title",
      company: "Company A",
      description: "Job description",
      is_active: true,
      deleted_at: null,
      expires_at: null,
      created_at: "2026-02-10T00:00:00Z",
    },
  ]);

  const result = simulateDeleteJob(
    { auth: AuthPresets.orgAlumni(ctx.organizationId), jobId: "job-1" },
    ctx
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.success, true);
});

test("DELETE /api/jobs/[jobId] - admin can delete any job", () => {
  const ctx = createTestContext();

  ctx.supabase.seed("job_postings", [
    {
      id: "job-1",
      organization_id: ctx.organizationId,
      posted_by: "alumni-user",
      title: "Job Title",
      company: "Company A",
      description: "Job description",
      is_active: true,
      deleted_at: null,
      expires_at: null,
      created_at: "2026-02-10T00:00:00Z",
    },
  ]);

  const result = simulateDeleteJob(
    { auth: AuthPresets.orgAdmin(ctx.organizationId), jobId: "job-1" },
    ctx
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.success, true);
});

test("DELETE /api/jobs/[jobId] - soft deletes (sets deleted_at, not hard delete)", () => {
  const ctx = createTestContext();

  ctx.supabase.seed("job_postings", [
    {
      id: "job-1",
      organization_id: ctx.organizationId,
      posted_by: "alumni-user",
      title: "Job Title",
      company: "Company A",
      description: "Job description",
      is_active: true,
      deleted_at: null,
      expires_at: null,
      created_at: "2026-02-10T00:00:00Z",
    },
  ]);

  simulateDeleteJob(
    { auth: AuthPresets.orgAlumni(ctx.organizationId), jobId: "job-1" },
    ctx
  );

  const jobs = ctx.supabase.getRows("job_postings") as JobPostingRow[];
  const deletedJob = jobs.find((j) => j.id === "job-1");

  assert.ok(deletedJob);
  assert.ok(deletedJob.deleted_at !== null);
});
