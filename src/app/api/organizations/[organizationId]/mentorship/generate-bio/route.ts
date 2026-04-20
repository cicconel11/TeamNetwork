import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { baseSchemas } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { generateMentorBio, type BioGenerationInput } from "@/lib/mentorship/bio-generator";
import { canonicalizeIndustry, canonicalizeRoleFamily } from "@/lib/falkordb/career-signals";
import { resolveMentorshipConfig } from "@/lib/mentorship/matching-weights";
import { logAiRequest } from "@/lib/ai/audit";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  user_id: baseSchemas.uuid,
});

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const orgParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = checkRateLimit(req, {
    userId: user.id,
    orgId: organizationId,
    feature: "mentorship bio generation",
    limitPerUser: 5,
  });
  if (!rl.ok) return buildRateLimitResponse(rl);

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const service = createServiceClient();

  // Auth: caller must be the target user or an org admin
  const membershipUserIds =
    user.id === body.user_id ? [user.id] : [user.id, body.user_id];

  const { data: memberships } = await service
    .from("user_organization_roles")
    .select("user_id,role,status")
    .eq("organization_id", organizationId)
    .in("user_id", membershipUserIds);

  const callerMembership =
    (memberships ?? []).find((row) => row.user_id === user.id) ?? null;

  const isAdmin = callerMembership?.role === "admin" && callerMembership?.status === "active";
  const isSelf = user.id === body.user_id && callerMembership?.status === "active";

  if (!isAdmin && !isSelf) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch alumni data, org settings, and user info in parallel
  // Alumni enrichment columns not in generated types — use type assertion
  type AlumniQueryClient = {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => {
            maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
          };
        };
      };
    };
  };

  const [alumniResult, orgResult, userResult] = await Promise.all([
    (service as unknown as AlumniQueryClient)
      .from("alumni")
      .select("headline, summary, job_title, position_title, current_company, current_city, industry, graduation_year, major, school")
      .eq("user_id", body.user_id)
      .eq("organization_id", organizationId)
      .maybeSingle(),
    (service as unknown as AlumniQueryClient)
      .from("organizations")
      .select("settings, name")
      .eq("id", organizationId)
      .eq("id", organizationId) // dummy second eq for type compat
      .maybeSingle(),
    service
      .from("user_organization_roles")
      .select("user_id, users(name)")
      .eq("user_id", body.user_id)
      .eq("organization_id", organizationId)
      .maybeSingle(),
  ]);

  const alumni = alumniResult.data;
  const orgSettings = orgResult.data;
  const userName = (() => {
    const users = (userResult.data as unknown as { users: { name: string | null } | null })?.users;
    return users?.name ?? "Member";
  })();

  if (!alumni && !orgSettings) {
    // No data at all — return empty
    return NextResponse.json({ bio: "", topics: [], expertiseAreas: [] });
  }

  // Get custom attribute defs and mentor's custom attributes
  const config = resolveMentorshipConfig(orgSettings?.settings);
  const customAttrsForBio: Record<string, string> = {};
  for (const def of config.customAttributeDefs) {
    if (def.type === "text") continue;
    // Check if there's an existing mentor profile with custom attrs
    // (for bio regeneration on existing profiles)
    // For new registrations, custom attrs will be empty
  }

  // Canonicalize
  const rawIndustry = (alumni?.industry as string) ?? null;
  const rawJobTitle = (alumni?.job_title as string) ?? (alumni?.position_title as string) ?? null;
  const rawCompany = (alumni?.current_company as string) ?? null;
  const industry = canonicalizeIndustry(rawIndustry);
  const roleFamily = canonicalizeRoleFamily(rawJobTitle, rawCompany, industry);

  const input: BioGenerationInput = {
    name: userName,
    jobTitle: rawJobTitle,
    currentCompany: rawCompany,
    industry,
    roleFamily,
    graduationYear: (alumni?.graduation_year as number) ?? null,
    linkedinSummary: (alumni?.summary as string) ?? null,
    linkedinHeadline: (alumni?.headline as string) ?? null,
    customAttributes: Object.keys(customAttrsForBio).length > 0 ? customAttrsForBio : null,
    orgName: (orgSettings?.name as string) ?? "",
  };

  const result = await generateMentorBio(input);

  // Audit log (fire and forget)
  logAiRequest(
    service as unknown as SupabaseClient,
    {
      threadId: null,
      messageId: null,
      userId: body.user_id,
      orgId: organizationId,
      intent: "bio_generation",
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: result.latencyMs,
    }
  ).catch(() => {/* audit log failures are non-critical */});

  return NextResponse.json({
    bio: result.bio,
    topics: result.topics,
    expertiseAreas: result.expertiseAreas,
    inputHash: result.inputHash,
  });
}
