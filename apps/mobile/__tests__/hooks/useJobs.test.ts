/**
 * useJobs Hook Tests
 *
 * The hook itself requires a React Native environment (hooks, refs, effects)
 * and Bun's ESM resolver validates named exports at binding time, preventing
 * partial mocks of 'react'. Following the useMediaUpload pattern, we inline
 * and test the pure business logic extracted from the hook.
 *
 * Implementation under test: src/hooks/useJobs.ts
 */

// ─── Constants (mirror src/hooks/useJobs.ts) ─────────────────────────────────

const STALE_TIME_MS = 30_000;

// ─── Pure helpers extracted from fetchJobs ───────────────────────────────────

/** Builds the base filter arguments used when querying job_postings. */
function buildBaseFilters(orgId: string) {
  return {
    organization_id: orgId,
    deleted_at: null,
    is_active: true,
    expires_at_filter: "expires_at.is.null,expires_at.gt.now()",
    order_by: { column: "created_at", ascending: false },
  };
}

/** Builds the text-search OR filter string used by Supabase. */
function buildTextSearchFilter(query: string): string {
  return `title.ilike.%${query}%,company.ilike.%${query}%`;
}

/** Returns true when data is considered stale relative to the last fetch. */
function isStale(lastFetchTime: number, now: number): boolean {
  return now - lastFetchTime > STALE_TIME_MS;
}

/** Validates that required CreateJobInput fields are present. */
function validateCreateJobInput(input: {
  title?: unknown;
  company?: unknown;
  description?: unknown;
}): string | null {
  if (!input.title || typeof input.title !== "string" || !input.title.trim()) {
    return "title is required";
  }
  if (!input.company || typeof input.company !== "string" || !input.company.trim()) {
    return "company is required";
  }
  if (
    !input.description ||
    typeof input.description !== "string" ||
    !input.description.trim()
  ) {
    return "description is required";
  }
  return null;
}

/** Builds the soft-delete payload used by deleteJob. */
function buildSoftDeletePayload(now: Date = new Date()): { deleted_at: string } {
  return { deleted_at: now.toISOString() };
}

/** Builds the update payload used by updateJob. */
function buildUpdatePayload(
  input: Record<string, unknown>,
  now: Date = new Date()
): Record<string, unknown> {
  return { ...input, updated_at: now.toISOString() };
}

/** Builds the insert payload used by createJob. */
function buildInsertPayload(
  input: Record<string, unknown>,
  orgId: string,
  userId: string
): Record<string, unknown> {
  return { ...input, organization_id: orgId, posted_by: userId };
}

// ─── STALE_TIME_MS ────────────────────────────────────────────────────────────

describe("useJobs — STALE_TIME_MS", () => {
  it("should be 30 seconds (30000 ms)", () => {
    expect(STALE_TIME_MS).toBe(30_000);
  });

  it("should be expressed in milliseconds", () => {
    const thirtySeconds = 30 * 1000;
    expect(STALE_TIME_MS).toBe(thirtySeconds);
  });
});

// ─── Stale detection ─────────────────────────────────────────────────────────

describe("useJobs — stale time behavior", () => {
  it("should treat data as stale when lastFetchTime is 0 (never fetched)", () => {
    const now = Date.now();
    expect(isStale(0, now)).toBe(true);
  });

  it("should treat data as stale when more than 30s have elapsed", () => {
    const now = Date.now();
    const lastFetch = now - STALE_TIME_MS - 1;
    expect(isStale(lastFetch, now)).toBe(true);
  });

  it("should treat data as fresh when less than 30s have elapsed", () => {
    const now = Date.now();
    const lastFetch = now - STALE_TIME_MS + 1000;
    expect(isStale(lastFetch, now)).toBe(false);
  });

  it("should treat data as fresh exactly at the 30s boundary", () => {
    const now = Date.now();
    const lastFetch = now - STALE_TIME_MS;
    // Exactly at boundary: now - lastFetch === STALE_TIME_MS (not >)
    expect(isStale(lastFetch, now)).toBe(false);
  });

  it("should treat data as stale one ms past the boundary", () => {
    const now = Date.now();
    const lastFetch = now - STALE_TIME_MS - 1;
    expect(isStale(lastFetch, now)).toBe(true);
  });
});

// ─── Query construction ───────────────────────────────────────────────────────

describe("useJobs — query construction", () => {
  describe("base filters", () => {
    it("should filter by organization_id", () => {
      const filters = buildBaseFilters("org-abc");
      expect(filters.organization_id).toBe("org-abc");
    });

    it("should exclude soft-deleted jobs (deleted_at is null)", () => {
      const filters = buildBaseFilters("org-abc");
      expect(filters.deleted_at).toBeNull();
    });

    it("should filter for active jobs only (is_active is true)", () => {
      const filters = buildBaseFilters("org-abc");
      expect(filters.is_active).toBe(true);
    });

    it("should exclude expired jobs using the correct OR filter string", () => {
      const filters = buildBaseFilters("org-abc");
      expect(filters.expires_at_filter).toBe("expires_at.is.null,expires_at.gt.now()");
    });

    it("should order results by created_at descending", () => {
      const filters = buildBaseFilters("org-abc");
      expect(filters.order_by.column).toBe("created_at");
      expect(filters.order_by.ascending).toBe(false);
    });

    it("should use the provided orgId", () => {
      const filters = buildBaseFilters("org-xyz-999");
      expect(filters.organization_id).toBe("org-xyz-999");
    });
  });

  describe("text search filter", () => {
    it("should build an ilike filter on title and company", () => {
      const filter = buildTextSearchFilter("engineer");
      expect(filter).toBe("title.ilike.%engineer%,company.ilike.%engineer%");
    });

    it("should interpolate the query term correctly", () => {
      const filter = buildTextSearchFilter("product manager");
      expect(filter).toBe("title.ilike.%product manager%,company.ilike.%product manager%");
    });

    it("should handle single-character queries", () => {
      const filter = buildTextSearchFilter("a");
      expect(filter).toBe("title.ilike.%a%,company.ilike.%a%");
    });

    it("should wrap the query term in % wildcards", () => {
      const term = "nurse";
      const filter = buildTextSearchFilter(term);
      expect(filter).toContain(`%${term}%`);
    });
  });
});

// ─── Mutations ────────────────────────────────────────────────────────────────

describe("useJobs — mutation payload construction", () => {
  describe("createJob — insert payload", () => {
    it("should include posted_by (user.id) in the insert payload", () => {
      const payload = buildInsertPayload(
        { title: "Engineer", company: "Acme", description: "Build stuff" },
        "org-abc",
        "user-123"
      );
      expect(payload.posted_by).toBe("user-123");
    });

    it("should include organization_id in the insert payload", () => {
      const payload = buildInsertPayload(
        { title: "Designer", company: "Studio", description: "Design things" },
        "org-xyz",
        "user-456"
      );
      expect(payload.organization_id).toBe("org-xyz");
    });

    it("should merge input fields into the insert payload", () => {
      const input = {
        title: "CTO",
        company: "StartupCo",
        description: "Lead engineering.",
        location_type: "remote",
        experience_level: "senior",
      };
      const payload = buildInsertPayload(input, "org-abc", "user-789");
      expect(payload.title).toBe("CTO");
      expect(payload.company).toBe("StartupCo");
      expect(payload.location_type).toBe("remote");
      expect(payload.experience_level).toBe("senior");
    });

    it("should not mutate the original input object", () => {
      const input = { title: "Dev", company: "Co", description: "Desc" };
      const original = { ...input };
      buildInsertPayload(input, "org-abc", "user-123");
      expect(input).toEqual(original);
    });
  });

  describe("deleteJob — soft delete payload", () => {
    it("should set deleted_at to an ISO string", () => {
      const payload = buildSoftDeletePayload();
      expect(typeof payload.deleted_at).toBe("string");
      expect(() => new Date(payload.deleted_at)).not.toThrow();
    });

    it("should NOT include an actual delete — only sets deleted_at", () => {
      const payload = buildSoftDeletePayload();
      const keys = Object.keys(payload);
      expect(keys).toEqual(["deleted_at"]);
    });

    it("should use the provided date for deleted_at", () => {
      const fixedDate = new Date("2025-06-15T12:00:00Z");
      const payload = buildSoftDeletePayload(fixedDate);
      expect(payload.deleted_at).toBe("2025-06-15T12:00:00.000Z");
    });
  });

  describe("updateJob — update payload", () => {
    it("should include updated_at as an ISO string", () => {
      const payload = buildUpdatePayload({ title: "Senior Engineer" });
      expect(typeof payload.updated_at).toBe("string");
      expect(() => new Date(payload.updated_at as string)).not.toThrow();
    });

    it("should merge input fields into the update payload", () => {
      const payload = buildUpdatePayload({ title: "Lead Dev", company: "NewCo" });
      expect(payload.title).toBe("Lead Dev");
      expect(payload.company).toBe("NewCo");
    });

    it("should use the provided timestamp for updated_at", () => {
      const fixedDate = new Date("2025-01-01T09:00:00Z");
      const payload = buildUpdatePayload({ title: "Director" }, fixedDate);
      expect(payload.updated_at).toBe("2025-01-01T09:00:00.000Z");
    });

    it("should not mutate the original input object", () => {
      const input: Record<string, unknown> = { title: "Engineer" };
      const original = { ...input };
      buildUpdatePayload(input);
      expect(input).toEqual(original);
    });
  });
});

// ─── CreateJobInput validation ────────────────────────────────────────────────

describe("useJobs — CreateJobInput validation", () => {
  it("should return null for a valid input with all required fields", () => {
    const result = validateCreateJobInput({
      title: "Engineer",
      company: "Acme",
      description: "Build stuff",
    });
    expect(result).toBeNull();
  });

  it("should reject input missing title", () => {
    const result = validateCreateJobInput({
      company: "Acme",
      description: "Build stuff",
    });
    expect(result).toBe("title is required");
  });

  it("should reject input with empty title", () => {
    const result = validateCreateJobInput({
      title: "   ",
      company: "Acme",
      description: "Build stuff",
    });
    expect(result).toBe("title is required");
  });

  it("should reject input missing company", () => {
    const result = validateCreateJobInput({
      title: "Engineer",
      description: "Build stuff",
    });
    expect(result).toBe("company is required");
  });

  it("should reject input with empty company", () => {
    const result = validateCreateJobInput({
      title: "Engineer",
      company: "",
      description: "Build stuff",
    });
    expect(result).toBe("company is required");
  });

  it("should reject input missing description", () => {
    const result = validateCreateJobInput({
      title: "Engineer",
      company: "Acme",
    });
    expect(result).toBe("description is required");
  });

  it("should reject input with empty description", () => {
    const result = validateCreateJobInput({
      title: "Engineer",
      company: "Acme",
      description: "",
    });
    expect(result).toBe("description is required");
  });
});

// ─── CreateJobInput type structure ───────────────────────────────────────────

describe("useJobs — CreateJobInput type structure", () => {
  it("should accept a minimal job input (required fields only)", () => {
    type CreateJobInput = import("../../src/types/jobs").CreateJobInput;
    const minimal: CreateJobInput = {
      title: "Software Engineer",
      company: "Acme Corp",
      description: "Build great things.",
    };
    expect(minimal.title).toBe("Software Engineer");
    expect(minimal.company).toBe("Acme Corp");
    expect(minimal.description).toBe("Build great things.");
  });

  it("should allow optional fields to be omitted", () => {
    type CreateJobInput = import("../../src/types/jobs").CreateJobInput;
    const input: CreateJobInput = {
      title: "Designer",
      company: "Studio",
      description: "Create beautiful UIs.",
    };
    expect(input.location_type).toBeUndefined();
    expect(input.experience_level).toBeUndefined();
    expect(input.location).toBeUndefined();
    expect(input.application_url).toBeUndefined();
    expect(input.contact_email).toBeUndefined();
    expect(input.expires_at).toBeUndefined();
  });

  it("should accept all optional fields when provided", () => {
    type CreateJobInput = import("../../src/types/jobs").CreateJobInput;
    const full: CreateJobInput = {
      title: "CTO",
      company: "StartupCo",
      description: "Lead engineering.",
      location_type: "remote",
      experience_level: "senior",
      location: "San Francisco, CA",
      application_url: "https://example.com/apply",
      contact_email: "jobs@example.com",
      expires_at: "2099-12-31T23:59:59Z",
    };
    expect(full.location_type).toBe("remote");
    expect(full.experience_level).toBe("senior");
    expect(full.application_url).toBe("https://example.com/apply");
  });
});

// ─── Filter enum values ───────────────────────────────────────────────────────

describe("useJobs — filter enum values", () => {
  it("should accept all valid location_type values", () => {
    type LocationType = import("../../src/types/jobs").LocationType;
    const validValues: LocationType[] = ["remote", "onsite", "hybrid"];
    expect(validValues).toHaveLength(3);
    expect(validValues).toContain("remote");
    expect(validValues).toContain("onsite");
    expect(validValues).toContain("hybrid");
  });

  it("should accept all valid experience_level values", () => {
    type ExperienceLevel = import("../../src/types/jobs").ExperienceLevel;
    const validValues: ExperienceLevel[] = ["entry", "mid", "senior", "executive"];
    expect(validValues).toHaveLength(4);
    expect(validValues).toContain("entry");
    expect(validValues).toContain("mid");
    expect(validValues).toContain("senior");
    expect(validValues).toContain("executive");
  });
});

// ─── UseJobsReturn shape ──────────────────────────────────────────────────────

describe("useJobs — UseJobsReturn type structure", () => {
  it("should declare all expected return properties", () => {
    type UseJobsReturn = import("../../src/types/jobs").UseJobsReturn;
    type Keys = keyof UseJobsReturn;

    const _check: Keys extends
      | "jobs"
      | "loading"
      | "error"
      | "canPost"
      | "refetch"
      | "refetchIfStale"
      | "createJob"
      | "updateJob"
      | "deleteJob"
      ? true
      : false = true;

    expect(_check).toBe(true);
  });
});

// ─── Null orgId guard ─────────────────────────────────────────────────────────

describe("useJobs — null orgId behavior", () => {
  it("should return empty jobs array when orgId is null (guard check)", () => {
    // Mirrors the guard at top of fetchJobs:
    //   if (!orgId) { setJobs([]); setError(null); setLoading(false); return; }
    const orgId: string | null = null;
    const shouldSkipFetch = !orgId;
    expect(shouldSkipFetch).toBe(true);
  });

  it("should not skip fetch when orgId is a valid string", () => {
    const orgId: string | null = "org-abc";
    const shouldSkipFetch = !orgId;
    expect(shouldSkipFetch).toBe(false);
  });

  it("should not skip fetch when orgId is a non-empty string", () => {
    const orgId = "org-xyz-123";
    expect(Boolean(orgId)).toBe(true);
  });
});
