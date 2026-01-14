import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  linkedInProfileUrlSchema,
  normalizeLinkedInProfileUrl,
} from "@/lib/alumni/linkedin-url";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG_ID = "22222222-2222-4222-8222-222222222222";
const JANE_ALUMNI_ID = "33333333-3333-4333-8333-333333333333";
const ALEX_ALUMNI_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_ALUMNI_ID = "55555555-5555-4555-8555-555555555555";

const attachLinkedInSchema = z.object({
  alumniId: z.string().uuid(),
  linkedin_url: linkedInProfileUrlSchema,
  replace: z.boolean().optional().default(false),
});

interface AlumniRow {
  id: string;
  organization_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  linkedin_url: string | null;
  deleted_at?: string | null;
}

interface SearchResponseBody {
  results?: Array<{
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    linkedin_url: string | null;
  }>;
  error?: string;
}

interface AttachResponseBody {
  success?: boolean;
  unchanged?: boolean;
  replaced?: boolean;
  error?: string;
  code?: string;
  existingUrl?: string;
}

function simulateSearch(params: {
  userId: string | null;
  role: string | null;
  organizationId: string;
  query: string;
  limit?: number;
  alumniRows: AlumniRow[];
}): { status: number; body: SearchResponseBody } {
  if (!params.userId) return { status: 401, body: { error: "Unauthorized" } };
  if (params.role !== "admin") return { status: 403, body: { error: "Forbidden" } };

  const query = params.query.trim();
  if (!query) {
    return { status: 400, body: { error: "Invalid query parameters" } };
  }

  const tokens = Array.from(new Set(query.replace(/,/g, " ").split(/\s+/).filter(Boolean)));
  const matches = params.alumniRows
    .filter((row) => row.organization_id === params.organizationId && !row.deleted_at)
    .filter((row) => {
      const haystacks = [row.first_name, row.last_name, row.email ?? ""].map((value) => value.toLowerCase());
      return tokens.some((token) => haystacks.some((value) => value.includes(token.toLowerCase())));
    })
    .sort((a, b) => {
      const lastNameCompare = a.last_name.localeCompare(b.last_name);
      return lastNameCompare !== 0 ? lastNameCompare : a.first_name.localeCompare(b.first_name);
    })
    .slice(0, params.limit ?? 10)
    .map(({ id, first_name, last_name, email, linkedin_url }) => ({
      id,
      first_name,
      last_name,
      email,
      linkedin_url,
    }));

  return { status: 200, body: { results: matches } };
}

function simulateAttach(params: {
  userId: string | null;
  role: string | null;
  organizationId: string;
  isReadOnly?: boolean;
  body: unknown;
  alumniRows: AlumniRow[];
}): { status: number; body: AttachResponseBody } {
  if (!params.userId) return { status: 401, body: { error: "Unauthorized" } };
  if (params.role !== "admin") return { status: 403, body: { error: "Forbidden" } };
  if (params.isReadOnly) {
    return {
      status: 403,
      body: {
        error: "Organization is in read-only mode. Please resubscribe to make changes.",
        code: "ORG_READ_ONLY",
      },
    };
  }

  const parsed = attachLinkedInSchema.safeParse(params.body);
  if (!parsed.success) {
    return { status: 400, body: { error: "Invalid request body" } };
  }

  const alumni = params.alumniRows.find(
    (row) =>
      row.id === parsed.data.alumniId &&
      row.organization_id === params.organizationId &&
      !row.deleted_at,
  );

  if (!alumni) {
    return { status: 404, body: { error: "Alumni not found" } };
  }

  const incomingUrl = parsed.data.linkedin_url;
  const existingUrl = alumni.linkedin_url
    ? normalizeLinkedInProfileUrl(alumni.linkedin_url)
    : null;

  if (existingUrl && existingUrl === incomingUrl) {
    return { status: 200, body: { success: true, unchanged: true } };
  }

  if (existingUrl && !parsed.data.replace) {
    return {
      status: 409,
      body: {
        error: "LinkedIn URL already exists for this alumni",
        code: "LINKEDIN_URL_EXISTS",
        existingUrl,
      },
    };
  }

  alumni.linkedin_url = incomingUrl;
  return { status: 200, body: { success: true, replaced: Boolean(existingUrl) } };
}

describe("alumni search", () => {
  const alumniRows: AlumniRow[] = [
    {
      id: JANE_ALUMNI_ID,
      organization_id: ORG_ID,
      first_name: "Jane",
      last_name: "Smith",
      email: "jane@example.com",
      linkedin_url: null,
    },
    {
      id: ALEX_ALUMNI_ID,
      organization_id: ORG_ID,
      first_name: "Alex",
      last_name: "Johnson",
      email: "alex@example.com",
      linkedin_url: null,
    },
    {
      id: OTHER_ALUMNI_ID,
      organization_id: OTHER_ORG_ID,
      first_name: "Jane",
      last_name: "Other",
      email: "jane@other.com",
      linkedin_url: null,
    },
  ];

  test("requires authentication", () => {
    const result = simulateSearch({
      userId: null,
      role: null,
      organizationId: ORG_ID,
      query: "jane",
      alumniRows,
    });
    assert.equal(result.status, 401);
  });

  test("requires admin role", () => {
    const result = simulateSearch({
      userId: "user-1",
      role: "active_member",
      organizationId: ORG_ID,
      query: "jane",
      alumniRows,
    });
    assert.equal(result.status, 403);
  });

  test("matches alumni by name or email within the organization", () => {
    const result = simulateSearch({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      query: "jane",
      alumniRows,
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.results?.length, 1);
    assert.equal(result.body.results?.[0]?.email, "jane@example.com");
  });

  test("splits comma-separated queries into searchable tokens", () => {
    const result = simulateSearch({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      query: "Jane,Smith",
      alumniRows,
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.results?.length, 1);
    assert.equal(result.body.results?.[0]?.id, JANE_ALUMNI_ID);
  });
});

describe("single LinkedIn attach", () => {
  test("requires authentication", () => {
    const result = simulateAttach({
      userId: null,
      role: null,
      organizationId: ORG_ID,
      body: {
        alumniId: JANE_ALUMNI_ID,
        linkedin_url: "https://www.linkedin.com/in/jane-smith",
      },
      alumniRows: [],
    });

    assert.equal(result.status, 401);
  });

  test("requires admin role", () => {
    const result = simulateAttach({
      userId: "user-1",
      role: "active_member",
      organizationId: ORG_ID,
      body: {
        alumniId: JANE_ALUMNI_ID,
        linkedin_url: "https://www.linkedin.com/in/jane-smith",
      },
      alumniRows: [],
    });

    assert.equal(result.status, 403);
  });

  test("rejects updates while the organization is read-only", () => {
    const result = simulateAttach({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      isReadOnly: true,
      body: {
        alumniId: JANE_ALUMNI_ID,
        linkedin_url: "https://www.linkedin.com/in/jane-smith",
      },
      alumniRows: [],
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.code, "ORG_READ_ONLY");
  });

  test("returns not found when the alumni record is missing", () => {
    const result = simulateAttach({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        alumniId: "66666666-6666-4666-8666-666666666666",
        linkedin_url: "https://www.linkedin.com/in/jane-smith",
      },
      alumniRows: [],
    });

    assert.equal(result.status, 404);
  });

  test("creates a LinkedIn URL when one does not exist", () => {
    const alumniRows: AlumniRow[] = [
      {
        id: JANE_ALUMNI_ID,
        organization_id: ORG_ID,
        first_name: "Jane",
        last_name: "Smith",
        email: "jane@example.com",
        linkedin_url: null,
      },
    ];

    const result = simulateAttach({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        alumniId: JANE_ALUMNI_ID,
        linkedin_url: "http://linkedin.com/in/jane-smith/",
      },
      alumniRows,
    });

    assert.equal(result.status, 200);
    assert.equal(alumniRows[0].linkedin_url, "https://www.linkedin.com/in/jane-smith");
  });

  test("requires explicit replace when a different LinkedIn URL already exists", () => {
    const result = simulateAttach({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        alumniId: JANE_ALUMNI_ID,
        linkedin_url: "https://www.linkedin.com/in/jane-new",
      },
      alumniRows: [
        {
          id: JANE_ALUMNI_ID,
          organization_id: ORG_ID,
          first_name: "Jane",
          last_name: "Smith",
          email: "jane@example.com",
          linkedin_url: "https://www.linkedin.com/in/jane-old",
        },
      ],
    });

    assert.equal(result.status, 409);
    assert.equal(result.body.code, "LINKEDIN_URL_EXISTS");
  });

  test("allows replace when explicitly confirmed", () => {
    const alumniRows: AlumniRow[] = [
      {
        id: JANE_ALUMNI_ID,
        organization_id: ORG_ID,
        first_name: "Jane",
        last_name: "Smith",
        email: "jane@example.com",
        linkedin_url: "https://www.linkedin.com/in/jane-old",
      },
    ];

    const result = simulateAttach({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        alumniId: JANE_ALUMNI_ID,
        linkedin_url: "https://www.linkedin.com/in/jane-new",
        replace: true,
      },
      alumniRows,
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.replaced, true);
    assert.equal(alumniRows[0].linkedin_url, "https://www.linkedin.com/in/jane-new");
  });

  test("treats an identical URL as unchanged", () => {
    const result = simulateAttach({
      userId: "user-1",
      role: "admin",
      organizationId: ORG_ID,
      body: {
        alumniId: JANE_ALUMNI_ID,
        linkedin_url: "http://linkedin.com/in/jane-smith/",
      },
      alumniRows: [
        {
          id: JANE_ALUMNI_ID,
          organization_id: ORG_ID,
          first_name: "Jane",
          last_name: "Smith",
          email: "jane@example.com",
          linkedin_url: "https://www.linkedin.com/in/jane-smith",
        },
      ],
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.unchanged, true);
  });
});
