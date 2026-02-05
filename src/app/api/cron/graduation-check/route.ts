import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/notifications";
import {
  getMembersNearingGraduation,
  getMembersPastGraduation,
  getOrganization,
  getOrgAdminEmails,
  checkAlumniCapacity,
  transitionToAlumni,
  revokeMemberAccess,
  markWarningSent,
  build30DayWarningEmail,
  buildGraduationEmail,
  buildNoCapacityEmail,
} from "@/lib/graduation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Daily cron job (8 AM UTC) to process member graduations.
 *
 * This endpoint:
 * 1. Sends 30-day warnings to admins for upcoming graduations
 * 2. Transitions graduated members to alumni (or revokes if no capacity)
 * 3. Notifies admins of all transitions
 */
export async function GET(request: Request) {
  const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";

  if (isProduction && !CRON_SECRET) {
    console.error("[cron/graduation-check] CRON_SECRET not configured in production");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  if (CRON_SECRET) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const supabase = createServiceClient();

    const results = {
      warningsSent: 0,
      transitionsToAlumni: 0,
      accessRevoked: 0,
      errors: [] as string[],
    };

    // Step 1: Send 30-day warnings
    const nearingGraduation = await getMembersNearingGraduation(supabase, 30);
    console.log(`[cron/graduation-check] Found ${nearingGraduation.length} members nearing graduation`);

    // Group by organization to avoid duplicate admin lookups
    const byOrgWarning = new Map<string, typeof nearingGraduation>();
    for (const member of nearingGraduation) {
      const orgMembers = byOrgWarning.get(member.organization_id) || [];
      orgMembers.push(member);
      byOrgWarning.set(member.organization_id, orgMembers);
    }

    for (const [orgId, members] of byOrgWarning) {
      const org = await getOrganization(supabase, orgId);
      if (!org) {
        results.errors.push(`Organization not found: ${orgId}`);
        continue;
      }

      const adminEmails = await getOrgAdminEmails(supabase, orgId);
      if (adminEmails.length === 0) {
        results.errors.push(`No admin emails found for org: ${org.name}`);
        continue;
      }

      for (const member of members) {
        const email = build30DayWarningEmail(member, org);
        let anyEmailSucceeded = false;

        for (const adminEmail of adminEmails) {
          const result = await sendEmail({
            to: adminEmail,
            subject: email.subject,
            body: email.body,
          });

          if (result.success) {
            anyEmailSucceeded = true;
          } else {
            results.errors.push(`Failed to send warning to ${adminEmail}: ${result.error}`);
          }
        }

        // Only mark warning as sent if at least one email was delivered
        // This allows retry on next cron run if all emails failed
        if (anyEmailSucceeded) {
          await markWarningSent(supabase, member.id);
          results.warningsSent++;
        }
      }
    }

    // Step 2: Process graduations
    const pastGraduation = await getMembersPastGraduation(supabase);
    console.log(`[cron/graduation-check] Found ${pastGraduation.length} members past graduation`);

    // Group by organization
    const byOrgGrad = new Map<string, typeof pastGraduation>();
    for (const member of pastGraduation) {
      const orgMembers = byOrgGrad.get(member.organization_id) || [];
      orgMembers.push(member);
      byOrgGrad.set(member.organization_id, orgMembers);
    }

    for (const [orgId, members] of byOrgGrad) {
      const org = await getOrganization(supabase, orgId);
      if (!org) {
        results.errors.push(`Organization not found: ${orgId}`);
        continue;
      }

      const adminEmails = await getOrgAdminEmails(supabase, orgId);

      for (const member of members) {
        // Skip members without a user account (can't transition roles)
        if (!member.user_id) {
          console.log(`[cron/graduation-check] Skipping member ${member.id} - no user_id`);
          continue;
        }

        // Check alumni capacity
        const { hasCapacity, currentCount, limit } = await checkAlumniCapacity(supabase, orgId);

        if (hasCapacity) {
          // Transition to alumni
          const result = await transitionToAlumni(supabase, member.id, member.user_id, orgId);

          if (result.success) {
            results.transitionsToAlumni++;
            const email = buildGraduationEmail(member, org);

            for (const adminEmail of adminEmails) {
              await sendEmail({
                to: adminEmail,
                subject: email.subject,
                body: email.body,
              });
            }
          } else {
            results.errors.push(`Failed to transition ${member.id}: ${result.error}`);
          }
        } else {
          // Revoke access
          const result = await revokeMemberAccess(supabase, member.id, member.user_id, orgId);

          if (result.success) {
            results.accessRevoked++;
            const email = buildNoCapacityEmail(member, org, currentCount, limit!);

            for (const adminEmail of adminEmails) {
              await sendEmail({
                to: adminEmail,
                subject: email.subject,
                body: email.body,
              });
            }
          } else {
            results.errors.push(`Failed to revoke ${member.id}: ${result.error}`);
          }
        }
      }
    }

    console.log("[cron/graduation-check] Completed:", results);

    return NextResponse.json({
      success: true,
      ...results,
    });
  } catch (err) {
    console.error("[cron/graduation-check] Error:", err);
    return NextResponse.json(
      {
        error: "Failed to process graduations",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
