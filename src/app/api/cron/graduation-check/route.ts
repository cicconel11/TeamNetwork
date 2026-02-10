import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/notifications";
import { debugLog, maskPII } from "@/lib/debug";
import {
  getMembersNearingGraduation,
  getMembersPastGraduation,
  getMembersToReinstate,
  getOrganization,
  getOrgAdminEmails,
  checkAlumniCapacity,
  transitionToAlumni,
  revokeMemberAccess,
  reinstateToActiveMember,
  markWarningSent,
  getGraduationDryRun,
  build30DayWarningEmail,
  buildGraduationEmail,
  buildNoCapacityEmail,
  buildReinstatementEmail,
} from "@/lib/graduation";

import { validateCronAuth } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Daily cron job (8 AM UTC) to process member graduations.
 *
 * This endpoint:
 * 1. Sends 30-day warnings to admins for upcoming graduations
 * 2. Transitions graduated members to alumni (or revokes if no capacity)
 * 3. Auto-reinstates members whose graduation date was moved to the future
 * 4. Notifies admins of all transitions
 *
 * Pass ?dry_run=true to preview what would happen without writing.
 */
export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  try {
    const supabase = createServiceClient();
    const url = new URL(request.url);
    const isDryRun = url.searchParams.get("dry_run") === "true";

    // Dry-run mode: return preview without writing
    if (isDryRun) {
      const dryRun = await getGraduationDryRun(supabase);
      return NextResponse.json({
        success: true,
        dryRun: true,
        warningsCount: dryRun.warnings.length,
        transitionsToAlumniCount: dryRun.toAlumni.length,
        accessRevokedCount: dryRun.toRevoke.length,
        reinstatesToActiveCount: dryRun.toReinstate.length,
        warnings: dryRun.warnings.map((m) => ({
          id: m.id,
          name: `${m.first_name || ""} ${m.last_name || ""}`.trim(),
          organization_id: m.organization_id,
          expected_graduation_date: m.expected_graduation_date,
        })),
        toAlumni: dryRun.toAlumni.map((m) => ({
          id: m.id,
          name: `${m.first_name || ""} ${m.last_name || ""}`.trim(),
          organization_id: m.organization_id,
          expected_graduation_date: m.expected_graduation_date,
        })),
        toRevoke: dryRun.toRevoke.map((m) => ({
          id: m.id,
          name: `${m.first_name || ""} ${m.last_name || ""}`.trim(),
          organization_id: m.organization_id,
          expected_graduation_date: m.expected_graduation_date,
        })),
        toReinstate: dryRun.toReinstate.map((m) => ({
          id: m.id,
          name: `${m.first_name || ""} ${m.last_name || ""}`.trim(),
          organization_id: m.organization_id,
          expected_graduation_date: m.expected_graduation_date,
        })),
        capacityByOrg: dryRun.capacityByOrg,
      });
    }

    const results = {
      warningsSent: 0,
      transitionsToAlumni: 0,
      accessRevoked: 0,
      reinstatesToActive: 0,
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

        debugLog("graduation-cron", "processing member", {
          memberId: maskPII(member.id),
          graduationDate: member.expected_graduation_date,
          orgId: maskPII(orgId),
        });

        // Check alumni capacity
        const { hasCapacity, currentCount, limit } = await checkAlumniCapacity(supabase, orgId);
        debugLog("graduation-cron", "capacity check", { hasCapacity, currentCount, limit });

        if (hasCapacity) {
          // Transition to alumni
          const result = await transitionToAlumni(supabase, member.id, member.user_id, orgId);

          if (result.success && !result.skipped) {
            results.transitionsToAlumni++;
            const email = buildGraduationEmail(member, org);

            for (const adminEmail of adminEmails) {
              await sendEmail({
                to: adminEmail,
                subject: email.subject,
                body: email.body,
              });
            }
          } else if (!result.success) {
            results.errors.push(`Failed to transition ${member.id}: ${result.error}`);
          }
        } else {
          // Revoke access
          const result = await revokeMemberAccess(supabase, member.id, member.user_id, orgId);

          if (result.success && !result.skipped) {
            results.accessRevoked++;
            const email = buildNoCapacityEmail(member, org, currentCount, limit!);

            for (const adminEmail of adminEmails) {
              await sendEmail({
                to: adminEmail,
                subject: email.subject,
                body: email.body,
              });
            }
          } else if (!result.success) {
            results.errors.push(`Failed to revoke ${member.id}: ${result.error}`);
          }
        }
      }
    }

    // Step 3: Reverse flow — reinstate members whose graduation date was moved forward
    const membersToReinstate = await getMembersToReinstate(supabase);
    console.log(`[cron/graduation-check] Found ${membersToReinstate.length} members to reinstate`);

    const byOrgReinstate = new Map<string, typeof membersToReinstate>();
    for (const member of membersToReinstate) {
      const orgMembers = byOrgReinstate.get(member.organization_id) || [];
      orgMembers.push(member);
      byOrgReinstate.set(member.organization_id, orgMembers);
    }

    for (const [orgId, members] of byOrgReinstate) {
      const org = await getOrganization(supabase, orgId);
      if (!org) {
        results.errors.push(`Organization not found: ${orgId}`);
        continue;
      }

      const adminEmails = await getOrgAdminEmails(supabase, orgId);

      for (const member of members) {
        if (!member.user_id) {
          console.log(`[cron/graduation-check] Skipping reinstate for member ${member.id} - no user_id`);
          continue;
        }

        const result = await reinstateToActiveMember(
          supabase,
          member.id,
          member.user_id,
          orgId,
          "active"
        );

        if (result.success && !result.skipped) {
          results.reinstatesToActive++;
          const email = buildReinstatementEmail(member, org);

          for (const adminEmail of adminEmails) {
            await sendEmail({
              to: adminEmail,
              subject: email.subject,
              body: email.body,
            });
          }
        } else if (!result.success) {
          results.errors.push(`Failed to reinstate ${member.id}: ${result.error}`);
        }
      }
    }

    console.log("[cron/graduation-check] Completed:", results);
    debugLog("graduation-cron", "batch summary", {
      totalProcessed: pastGraduation.length,
      transitioned: results.transitionsToAlumni,
      revoked: results.accessRevoked,
      reinstated: results.reinstatesToActive,
      warningsSent: results.warningsSent,
      errors: results.errors.length,
    });

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
