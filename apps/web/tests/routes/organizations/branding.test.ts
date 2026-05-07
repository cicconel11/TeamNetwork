import test from "node:test";
import assert from "node:assert";
import {
  AuthContext,
  isAuthenticated,
  isOrgAdmin,
  AuthPresets,
} from "../../utils/authMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

/**
 * Tests for POST /api/organizations/[orgId]/branding
 *
 * This route handles organization branding updates:
 * 1. Requires admin authentication
 * 2. Accepts FormData with primaryColor, secondaryColor, and/or logo file
 * 3. Validates hex color format (#RRGGBB)
 * 4. Validates logo file type and size (PNG, JPG, GIF, WebP, max 5MB)
 * 5. Blocks mutations in read-only mode (grace period)
 */

// Types
interface BrandingRequest {
  auth: AuthContext;
  organizationId?: string;
  primaryColor?: string;
  secondaryColor?: string;
  logoFile?: {
    name: string;
    type: string;
    size: number;
  } | null;
}

interface BrandingResult {
  status: number;
  organization?: {
    id: string;
    primary_color?: string;
    secondary_color?: string;
    logo_url?: string;
  };
  error?: string;
}

interface BrandingContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  organization?: {
    id: string;
    name: string;
    slug: string;
    primary_color?: string;
    secondary_color?: string;
    logo_url?: string;
  };
  isReadOnly?: boolean;
}

// Color validation
function isValidHexColor(color: string | undefined): { valid: boolean; normalized?: string } {
  if (!color) return { valid: true }; // Optional, so empty is valid
  const trimmed = color.trim();
  if (!trimmed) return { valid: true };
  const match = trimmed.match(/^#([0-9a-fA-F]{6})$/);
  if (!match) return { valid: false };
  return { valid: true, normalized: `#${match[1].toLowerCase()}` };
}

// File validation constants
const MAX_LOGO_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);

function simulateBrandingUpdate(
  request: BrandingRequest,
  ctx: BrandingContext
): BrandingResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  if (!request.organizationId) {
    return { status: 400, error: "Invalid organization id" };
  }

  if (!isOrgAdmin(request.auth, request.organizationId)) {
    return { status: 403, error: "Forbidden" };
  }

  if (ctx.isReadOnly) {
    return { status: 403, error: "Organization is in read-only mode" };
  }

  // Validate colors
  const primaryValidation = isValidHexColor(request.primaryColor);
  if (!primaryValidation.valid) {
    return { status: 400, error: "Primary color must be a 6-digit hex value like #1e3a5f." };
  }

  const secondaryValidation = isValidHexColor(request.secondaryColor);
  if (!secondaryValidation.valid) {
    return { status: 400, error: "Secondary color must be a 6-digit hex value like #10b981." };
  }

  // Validate logo if provided
  if (request.logoFile) {
    if (!ALLOWED_LOGO_TYPES.has(request.logoFile.type)) {
      return { status: 400, error: "Logo must be a PNG, JPG, GIF, or WebP image." };
    }
    if (request.logoFile.size > MAX_LOGO_BYTES) {
      return { status: 400, error: "Logo must be under 5MB." };
    }
  }

  // Check if there's anything to update
  const hasLogoUpdate = !!request.logoFile;
  const hasPrimaryUpdate = !!primaryValidation.normalized;
  const hasSecondaryUpdate = !!secondaryValidation.normalized;

  if (!hasLogoUpdate && !hasPrimaryUpdate && !hasSecondaryUpdate) {
    return { status: 400, error: "Provide a logo or updated colors to save." };
  }

  if (!ctx.organization) {
    return { status: 404, error: "Organization not found" };
  }

  // Build response
  const updatedOrg: BrandingResult["organization"] = {
    id: ctx.organization.id,
    primary_color: primaryValidation.normalized || ctx.organization.primary_color,
    secondary_color: secondaryValidation.normalized || ctx.organization.secondary_color,
    logo_url: hasLogoUpdate ? `https://storage.example.com/org-branding/${ctx.organization.id}/logo.png` : ctx.organization.logo_url,
  };

  return { status: 200, organization: updatedOrg };
}

// Tests

test("branding requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateBrandingUpdate(
    { auth: AuthPresets.unauthenticated, organizationId: "org-1", primaryColor: "#1e3a5f" },
    { supabase, organization: { id: "org-1", name: "Test", slug: "test" } }
  );
  assert.strictEqual(result.status, 401);
});

test("branding requires admin role", () => {
  const supabase = createSupabaseStub();
  const result = simulateBrandingUpdate(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", primaryColor: "#1e3a5f" },
    { supabase, organization: { id: "org-1", name: "Test", slug: "test" } }
  );
  assert.strictEqual(result.status, 403);
});

test("branding rejects alumni role", () => {
  const supabase = createSupabaseStub();
  const result = simulateBrandingUpdate(
    { auth: AuthPresets.orgAlumni("org-1"), organizationId: "org-1", primaryColor: "#1e3a5f" },
    { supabase, organization: { id: "org-1", name: "Test", slug: "test" } }
  );
  assert.strictEqual(result.status, 403);
});

test("branding blocks read-only mode", () => {
  const supabase = createSupabaseStub();
  const result = simulateBrandingUpdate(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", primaryColor: "#1e3a5f" },
    { supabase, organization: { id: "org-1", name: "Test", slug: "test" }, isReadOnly: true }
  );
  assert.strictEqual(result.status, 403);
  assert.strictEqual(result.error, "Organization is in read-only mode");
});

test("branding validates primary color format", () => {
  const supabase = createSupabaseStub();
  const result = simulateBrandingUpdate(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", primaryColor: "red" },
    { supabase, organization: { id: "org-1", name: "Test", slug: "test" } }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("Primary color"));
});

test("branding validates secondary color format", () => {
  const supabase = createSupabaseStub();
  const result = simulateBrandingUpdate(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", secondaryColor: "#FFF" },
    { supabase, organization: { id: "org-1", name: "Test", slug: "test" } }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("Secondary color"));
});

test("branding rejects invalid logo type", () => {
  const supabase = createSupabaseStub();
  const result = simulateBrandingUpdate(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      organizationId: "org-1",
      logoFile: { name: "logo.svg", type: "image/svg+xml", size: 1024 },
    },
    { supabase, organization: { id: "org-1", name: "Test", slug: "test" } }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("PNG, JPG, GIF, or WebP"));
});

test("branding rejects oversized logo", () => {
  const supabase = createSupabaseStub();
  const result = simulateBrandingUpdate(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      organizationId: "org-1",
      logoFile: { name: "logo.png", type: "image/png", size: 10 * 1024 * 1024 }, // 10MB
    },
    { supabase, organization: { id: "org-1", name: "Test", slug: "test" } }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("5MB"));
});

test("branding requires at least one field", () => {
  const supabase = createSupabaseStub();
  const result = simulateBrandingUpdate(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1" },
    { supabase, organization: { id: "org-1", name: "Test", slug: "test" } }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("Provide a logo or updated colors"));
});

test("branding updates primary color successfully", () => {
  const supabase = createSupabaseStub();
  const result = simulateBrandingUpdate(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", primaryColor: "#1E3A5F" },
    { supabase, organization: { id: "org-1", name: "Test", slug: "test" } }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.organization?.primary_color, "#1e3a5f"); // Normalized to lowercase
});

test("branding updates secondary color successfully", () => {
  const supabase = createSupabaseStub();
  const result = simulateBrandingUpdate(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", secondaryColor: "#10B981" },
    { supabase, organization: { id: "org-1", name: "Test", slug: "test" } }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.organization?.secondary_color, "#10b981");
});

test("branding uploads logo successfully", () => {
  const supabase = createSupabaseStub();
  const result = simulateBrandingUpdate(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      organizationId: "org-1",
      logoFile: { name: "logo.png", type: "image/png", size: 1024 },
    },
    { supabase, organization: { id: "org-1", name: "Test", slug: "test" } }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.organization?.logo_url?.includes("org-branding"));
});

test("branding accepts webp logo", () => {
  const supabase = createSupabaseStub();
  const result = simulateBrandingUpdate(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      organizationId: "org-1",
      logoFile: { name: "logo.webp", type: "image/webp", size: 2048 },
    },
    { supabase, organization: { id: "org-1", name: "Test", slug: "test" } }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.organization?.logo_url);
});

test("branding accepts gif logo", () => {
  const supabase = createSupabaseStub();
  const result = simulateBrandingUpdate(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      organizationId: "org-1",
      logoFile: { name: "logo.gif", type: "image/gif", size: 512 },
    },
    { supabase, organization: { id: "org-1", name: "Test", slug: "test" } }
  );
  assert.strictEqual(result.status, 200);
});

test("branding updates both colors simultaneously", () => {
  const supabase = createSupabaseStub();
  const result = simulateBrandingUpdate(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      organizationId: "org-1",
      primaryColor: "#000000",
      secondaryColor: "#ffffff",
    },
    { supabase, organization: { id: "org-1", name: "Test", slug: "test" } }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.organization?.primary_color, "#000000");
  assert.strictEqual(result.organization?.secondary_color, "#ffffff");
});
