export interface ProposalDeclinedCtx {
  mentorName: string;
  reason: string | null;
  directoryLink: string;
}

export const proposalDeclinedTemplate = (ctx: ProposalDeclinedCtx) => {
  const reasonSuffix = ctx.reason && ctx.reason.trim().length > 0
    ? ` — ${ctx.reason.trim()}`
    : "";
  return {
    title: "Mentorship request update",
    body: `${ctx.mentorName} can't mentor you right now${reasonSuffix}. Browse other mentors: ${ctx.directoryLink}`,
  };
};
