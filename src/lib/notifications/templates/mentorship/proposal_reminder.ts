export interface ProposalReminderCtx {
  pendingCount: number;
  reviewLink?: string;
}

export const proposalReminderTemplate = (ctx: ProposalReminderCtx) => {
  const s = ctx.pendingCount === 1 ? "" : "s";
  const link = ctx.reviewLink ? ` Review: ${ctx.reviewLink}` : "";
  return {
    title: `You have ${ctx.pendingCount} pending proposal${s}`,
    body: `An admin is reminding you to review your pending mentor proposal${s}.${link}`,
    category: "mentorship" as const,
  };
};
