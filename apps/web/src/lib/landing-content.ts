export const HERO_PROOF_POINTS = [
  { value: "10 min", label: "to launch an organization" },
  { value: "1 code", label: "for member onboarding" },
  { value: "24/7", label: "community history online" },
] as const;
export type HeroProofPoint = (typeof HERO_PROOF_POINTS)[number];

export const MARQUEE_ORG_TYPES = [
  "Sports Teams",
  "Greek Life",
  "Clubs",
  "Volunteer Orgs",
  "Alumni Groups",
  "Honor Societies",
  "Booster Clubs",
  "Student Government",
] as const;
export type MarqueeOrgType = (typeof MARQUEE_ORG_TYPES)[number];

export const PLAYBOOK_STEPS = [
  {
    step: "1",
    title: "Create your org",
    desc: "Sign up and customize your team’s profile, colors, and settings.",
  },
  {
    step: "2",
    title: "Invite members",
    desc: "Share your unique invite code or send email invitations.",
  },
  {
    step: "3",
    title: "Build your legacy",
    desc: "Track events, manage contributions, and connect generations.",
  },
] as const;
export type PlaybookStep = (typeof PLAYBOOK_STEPS)[number];

export const RULEBOOK_ITEMS = [
  { title: "Eligibility", text: "Must be 16+ to use the service." },
  { title: "Security", text: "You’re responsible for your credentials." },
  { title: "Conduct", text: "No illegal, harmful, or infringing content." },
  { title: "Payments", text: "Fees are non-refundable unless required by law." },
  { title: "Data & IP", text: "We retain software rights; you retain content rights." },
  { title: "Disputes", text: "Resolved via binding arbitration in New York." },
] as const;
export type RulebookItem = (typeof RULEBOOK_ITEMS)[number];
