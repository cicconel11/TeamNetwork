import type { ReportReason, ReportTargetType } from "@/lib/schemas/moderation";

export interface NewReportEmailContext {
  orgName: string;
  targetType: ReportTargetType;
  reason: ReportReason;
  reporterFirstName: string | null;
  details: string | null;
  reportId: string;
  reviewUrl: string | null;
}

const TARGET_LABEL: Record<ReportTargetType, string> = {
  chat_message: "chat message",
  feed_post: "feed post",
  feed_comment: "feed comment",
  user_profile: "member profile",
};

const REASON_LABEL: Record<ReportReason, string> = {
  spam: "Spam",
  harassment: "Harassment or bullying",
  hate: "Hate speech",
  sexual: "Sexual content",
  violence: "Violence or threats",
  self_harm: "Self-harm",
  illegal: "Illegal activity",
  impersonation: "Impersonation",
  other: "Other",
};

export function buildNewReportEmail(ctx: NewReportEmailContext): { subject: string; body: string } {
  const reporter = ctx.reporterFirstName ? ctx.reporterFirstName : "A member";
  const target = TARGET_LABEL[ctx.targetType];
  const reason = REASON_LABEL[ctx.reason];

  const lines = [
    `${reporter} reported a ${target} in ${ctx.orgName}.`,
    "",
    `Reason: ${reason}`,
  ];

  if (ctx.details && ctx.details.trim().length > 0) {
    lines.push("", "Details from reporter:", ctx.details.trim());
  }

  lines.push(
    "",
    `Report ID: ${ctx.reportId}`,
    "",
    "App Store policy requires action on reports within 24 hours. Please triage as soon as possible.",
  );

  if (ctx.reviewUrl) {
    lines.push("", `Review: ${ctx.reviewUrl}`);
  } else {
    lines.push(
      "",
      "Open Supabase Studio and query content_reports filtered by this report ID, or contact your TeamNetwork admin.",
    );
  }

  return {
    subject: `[TeamNetwork] New content report in ${ctx.orgName}`,
    body: lines.join("\n"),
  };
}
