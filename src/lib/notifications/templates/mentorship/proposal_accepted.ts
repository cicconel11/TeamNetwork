export interface ProposalAcceptedCtx {
  mentorName: string;
  chatLink: string;
}

export const proposalAcceptedTemplate = (ctx: ProposalAcceptedCtx) => ({
  title: "Your mentorship request was accepted",
  body: `${ctx.mentorName} accepted your mentorship request. You can now message them directly: ${ctx.chatLink}`,
});
