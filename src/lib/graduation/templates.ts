import type { GraduatingMember, OrgWithSlug } from "./queries";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.myteamnetwork.com";

interface EmailTemplate {
  subject: string;
  body: string;
}

/**
 * Build the 30-day warning email for admins.
 */
export function build30DayWarningEmail(
  member: GraduatingMember,
  org: OrgWithSlug
): EmailTemplate {
  const firstName = member.first_name || "Member";
  const lastName = member.last_name || "";
  const fullName = `${firstName} ${lastName}`.trim();
  const graduationDate = new Date(member.expected_graduation_date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const memberEditUrl = `${APP_URL}/${org.slug}/members/${member.id}/edit`;

  return {
    subject: `Member Graduating Soon: ${fullName}`,
    body: `${fullName} is scheduled to graduate on ${graduationDate}.

In 30 days, they will automatically transition to Alumni status.

Organization: ${org.name}

If this date is incorrect, update it in their profile:
${memberEditUrl}`,
  };
}

/**
 * Build the graduation complete email for admins.
 */
export function buildGraduationEmail(
  member: GraduatingMember,
  org: OrgWithSlug
): EmailTemplate {
  const firstName = member.first_name || "Member";
  const lastName = member.last_name || "";
  const fullName = `${firstName} ${lastName}`.trim();
  const graduationDate = new Date(member.expected_graduation_date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    subject: `Member Transitioned to Alumni: ${fullName}`,
    body: `${fullName} has graduated and been moved to Alumni status.

Organization: ${org.name}
Graduation Date: ${graduationDate}

They now have alumni-level access.`,
  };
}

/**
 * Build the no capacity email for admins (access revoked).
 */
export function buildNoCapacityEmail(
  member: GraduatingMember,
  org: OrgWithSlug,
  currentCount: number,
  limit: number
): EmailTemplate {
  const firstName = member.first_name || "Member";
  const lastName = member.last_name || "";
  const fullName = `${firstName} ${lastName}`.trim();
  const billingUrl = `${APP_URL}/${org.slug}/settings/billing`;

  return {
    subject: `[Action Required] Alumni Limit Reached - Access Revoked`,
    body: `${fullName} has graduated, but your organization has reached its alumni capacity.

Their access has been revoked.

Organization: ${org.name}
Current Alumni: ${currentCount}/${limit}

To restore their access, upgrade your plan:
${billingUrl}`,
  };
}

/**
 * Build the reinstatement email for admins (auto-reinstated because graduation date was moved forward).
 */
export function buildReinstatementEmail(
  member: GraduatingMember,
  org: OrgWithSlug
): EmailTemplate {
  const firstName = member.first_name || "Member";
  const lastName = member.last_name || "";
  const fullName = `${firstName} ${lastName}`.trim();
  const newGraduationDate = new Date(member.expected_graduation_date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const memberEditUrl = `${APP_URL}/${org.slug}/members/${member.id}/edit`;

  return {
    subject: `Member Auto-Reinstated: ${fullName}`,
    body: `${fullName} has been automatically reinstated to active member status.

Their graduation date was updated to ${newGraduationDate}, which is in the future.

Organization: ${org.name}

View their profile:
${memberEditUrl}`,
  };
}
