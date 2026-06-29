export type ShowcaseChapter = "Your network" | "Intelligence" | "Stay connected";

/**
 * Static per-chapter copy for the stacked feature blocks. The chapter name is the
 * eyebrow; `headline` is the block heading (its last word renders italic-accented)
 * and `blurb` is a one-line supporting summary. The rotating per-step `desc` still
 * drives the line that changes as a block's tabs switch.
 */
export const CHAPTER_META: Record<
  ShowcaseChapter,
  { headline: string; blurb: string }
> = {
  "Your network": {
    headline: "Everyone, in one living roster.",
    blurb: "Members, alumni, supporters, and mentors — searchable and always current.",
  },
  Intelligence: {
    headline: "AI that actually knows your org.",
    blurb: "Ask anything, and let smart matching find the right mentor for every member.",
  },
  "Stay connected": {
    headline: "Keep everyone in the loop.",
    blurb: "Events, threads, and opportunities shared across your whole community.",
  },
};

export type ShowcaseStep =
  | {
      kind: "image";
      chapter: ShowcaseChapter;
      title: string;
      desc: string;
      path: string;
      src: string;
      alt: string;
    }
  | {
      kind: "demo";
      chapter: ShowcaseChapter;
      title: string;
      desc: string;
      path: string;
      demo: "assistant" | "matching";
    };

/**
 * The showcase steps, grouped into three chapters (air.inc-style). The two AI
 * moments are `demo` steps — hand-built animated React components (AssistantDemo,
 * MatchingDemo) that show the AI's tool calls in action. Everything else is a real
 * product screenshot. The flat array order matters: it drives the tab order,
 * and chapters must stay contiguous (FeatureShowcase groups them in one pass).
 */
export const SHOWCASE_STEPS: ShowcaseStep[] = [
  // ── Your network ──────────────────────────────────────────────────────────
  {
    kind: "image",
    chapter: "Your network",
    title: "Network Directory",
    desc: "A living roster of members, alumni, supporters, and mentors — searchable, filterable, always current.",
    path: "/members",
    src: "/features/directory.png",
    alt: "The TeamNetwork member directory — student-athlete cards with roles and class years.",
  },
  {
    kind: "image",
    chapter: "Your network",
    title: "Enriched Profiles",
    desc: "Profiles enriched with real career data — companies, schools, and experience — so members can discover paths and grow their network.",
    path: "/members",
    src: "/features/profile.png",
    alt: "A member profile enriched with career details — company, school, and experience.",
  },
  {
    kind: "image",
    chapter: "Your network",
    title: "Shared History",
    desc: "Preserve your program's milestones, records, and recognition — institutional memory that lasts.",
    path: "/records",
    src: "/features/records.png",
    alt: "The TeamNetwork records board — program milestones and recognition by category.",
  },

  // ── Intelligence ──────────────────────────────────────────────────────────
  {
    kind: "demo",
    chapter: "Intelligence",
    title: "AI Assistant",
    desc: "Ask anything — it searches your network and drafts announcements, events, and messages that you review and confirm before they send.",
    path: "/assistant",
    demo: "assistant",
  },
  {
    kind: "demo",
    chapter: "Intelligence",
    title: "Smart Matching",
    desc: "AI ranks the best mentor for every member with a confidence score and the real reasons behind each match — shared paths, schools, industries, and skills.",
    path: "/mentorship",
    demo: "matching",
  },

  // ── Stay connected ────────────────────────────────────────────────────────
  {
    kind: "image",
    chapter: "Stay connected",
    title: "Team Events",
    desc: "Coordinate game days, banquets, alumni games, and fundraisers with RSVP tracking and shared schedules.",
    path: "/calendar",
    src: "/features/calendar.png",
    alt: "The TeamNetwork calendar — a month of team events, check-ins, and schedules.",
  },
  {
    kind: "image",
    chapter: "Stay connected",
    title: "Communication",
    desc: "Threads and announcements keep members, families, volunteers, and alumni in the loop.",
    path: "/messages",
    src: "/features/messages.png",
    alt: "TeamNetwork discussions — a team thread with replies from members.",
  },
  {
    kind: "image",
    chapter: "Stay connected",
    title: "Jobs",
    desc: "Career opportunities shared across your community — roles, internships, and referrals your network can see.",
    path: "/jobs",
    src: "/features/jobs.png",
    alt: "The TeamNetwork jobs board — roles and opportunities shared by the community.",
  },
];
