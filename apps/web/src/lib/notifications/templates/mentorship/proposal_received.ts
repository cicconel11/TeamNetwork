export interface ProposalReceivedCtx {
  menteeName: string;
  reviewLink: string;
}

export const proposalReceivedTemplate = (ctx: ProposalReceivedCtx) => ({
  title: "New mentorship request",
  body: `${ctx.menteeName} is requesting you as a mentor. Review the request: ${ctx.reviewLink}`,
});
