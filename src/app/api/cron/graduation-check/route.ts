import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/notifications";
import { debugLog, maskPII } from "@/lib/debug";
import {
  getMembersNearingGraduation,
  getMembersPastGraduation,
  getMembersToReinstate,
  batchGetOrganizations,
  batchGetOrgAdminEmails,
  batchCheckAlumniCapacity,
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

    // Group by organization
    const byOrgWarning = new Map<string, typeof nearingGraduation>();
    for (const member of nearingGraduation) {
      const orgMembers = byOrgWarning.get(member.organization_id) ?? [];
      orgMembers.push(member);
      byOrgWarning.set(member.organization_id, orgMembers);
    }

    if (byOrgWarning.size > 0) {
      const warningOrgIds = [...byOrgWarning.keys()];
      const [warningOrgs, warningAdminEmails] = await Promise.all([
        batchGetOrganizations(supabase, warningOrgIds),
        batchGetOrgAdminEmails(supabase, warningOrgIds),
      ]);

      for (const [orgId, members] of byOrgWarning) {
        const org = warningOrgs.get(orgId);
        if (!org) {
          results.errors.push(`Organization not found: ${orgId}`);
          continue;
        }

        const adminEmails = warningAdminEmails.get(orgId) ?? [];
        if (adminEmails.length === 0) {
          results.errors.push(`No admin emails found for org: ${org.name}`);
          continue;
        }

        for (const member of members) {
          const email = build30DayWarningEmail(member, org);
          let anyEmailSucceeded = false;

          // Keep emails sequential for Resend rate-limit safety
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
    }

    // Step 2: Process graduations
    const pastGraduation = await getMembersPastGraduation(supabase);
    console.log(`[cron/graduation-check] Found ${pastGraduation.length} members past graduation`);

    // Group by organization
    const byOrgGrad = new Map<string, typeof pastGraduation>();
    for (const member of pastGraduation) {
      const orgMembers = byOrgGrad.get(member.organization_id) ?? [];
      orgMembers.push(member);
      byOrgGrad.set(member.organization_id, orgMembers);
    }

    if (byOrgGrad.size > 0) {
      const gradOrgIds = [...byOrgGrad.keys()];
      const [gradOrgs, gradAdminEmails, capacityMap] = await Promise.all([
        batchGetOrganizations(supabase, gradOrgIds),
        batchGetOrgAdminEmails(supabase, gradOrgIds),
        // NOTE: batchCheckAlumniCapacity throws on DB error (fail-closed by design).
        // A throw here fails the entire graduation step so it can be retried on the
        // next cron run rather than silently graduating members without a capacity check.
        batchCheckAlumniCapacity(supabase, gradOrgIds),
      ]);

      // Use Promise.allSettled for error isolation — one org failing shouldn't block others
      const orgSettled = await Promise.allSettled(
        [...byOrgGrad.entries()].map(async ([orgId, members]) => {
          const org = gradOrgs.get(orgId);
          if (!org) {
            results.errors.push(`Organization not found: ${orgId}`);
            return;
          }

          const adminEmails = gradAdminEmails.get(orgId) ?? [];
          // Capacity is looked up once per-org from the pre-fetched map
          const capacity = capacityMap.get(orgId);
          if (!capacity) {
            results.errors.push(`Capacity info missing for org: ${orgId}`);
            return;
          }

          const { hasCapacity, currentCount, limit } = capacity;
          debugLog("graduation-cron", "capacity check", { orgId: maskPII(orgId), hasCapacity, currentCount, limit });

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

            if (hasCapacity) {
              // Transition to alumni
              const result = await transitionToAlumni(supabase, member.id, member.user_id, orgId);

              if (result.success && !result.skipped) {
                results.transitionsToAlumni++;
                const email = buildGraduationEmail(member, org);

                // Keep emails sequential for Resend rate-limit safety
                for (const adminEmail of adminEmails) {
                  await sendEmail({
                    to: adminEmail,
                    subject: email.subject,
                    body: email.body,
                  });
                }
              } else if (!result.success && !result.skipped) {
                // The RPC rejected the transition — most likely quota was exceeded mid-batch
                // (capacity snapshot was taken once per org, so a prior member in this same
                // batch may have consumed the last slot). Fall back to revoking access.
                const isQuotaError = result.error?.toLowerCase().includes("quota");
                if (isQuotaError) {
                  debugLog("graduation-cron", "quota exceeded mid-batch, falling back to revoke", {
                    memberId: maskPII(member.id),
                    orgId: maskPII(orgId),
                    error: result.error,
                  });
                  const revokeResult = await revokeMemberAccess(supabase, member.id, member.user_id, orgId);

                  if (revokeResult.success && !revokeResult.skipped) {
                    results.accessRevoked++;
                    const email = buildNoCapacityEmail(member, org, currentCount, limit!);

                    // Keep emails sequential for Resend rate-limit safety
                    for (const adminEmail of adminEmails) {
                      await sendEmail({
                        to: adminEmail,
                        subject: email.subject,
                        body: email.body,
                      });
                    }
                  } else if (!revokeResult.success) {
                    results.errors.push(`Failed to revoke ${member.id} after quota exceeded: ${revokeResult.error}`);
                  }
                } else {
                  results.errors.push(`Failed to transition ${member.id}: ${result.error}`);
                }
              }
            } else {
              // Revoke access
              const result = await revokeMemberAccess(supabase, member.id, member.user_id, orgId);

              if (result.success && !result.skipped) {
                results.accessRevoked++;
                const email = buildNoCapacityEmail(member, org, currentCount, limit!);

                // Keep emails sequential for Resend rate-limit safety
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
        })
      );

      for (const settled of orgSettled) {
        if (settled.status === "rejected") {
          const reason = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
          console.error("[cron/graduation-check] Org-level error during graduation:", reason);
          results.errors.push(`Org processing error: ${reason}`);
        }
      }
    }

    // Step 3: Reverse flow — reinstate members whose graduation date was moved forward
    const membersToReinstate = await getMembersToReinstate(supabase);
    console.log(`[cron/graduation-check] Found ${membersToReinstate.length} members to reinstate`);

    const byOrgReinstate = new Map<string, typeof membersToReinstate>();
    for (const member of membersToReinstate) {
      const orgMembers = byOrgReinstate.get(member.organization_id) ?? [];
      orgMembers.push(member);
      byOrgReinstate.set(member.organization_id, orgMembers);
    }

    if (byOrgReinstate.size > 0) {
      const reinstateOrgIds = [...byOrgReinstate.keys()];
      const [reinstateOrgs, reinstateAdminEmails] = await Promise.all([
        batchGetOrganizations(supabase, reinstateOrgIds),
        batchGetOrgAdminEmails(supabase, reinstateOrgIds),
      ]);

      for (const [orgId, members] of byOrgReinstate) {
        const org = reinstateOrgs.get(orgId);
        if (!org) {
          results.errors.push(`Organization not found: ${orgId}`);
          continue;
        }

        const adminEmails = reinstateAdminEmails.get(orgId) ?? [];

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

            // Keep emails sequential for Resend rate-limit safety
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
