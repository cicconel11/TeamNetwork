/**
 * Marketing copy + landing-page data shared between web and mobile.
 *
 * Icon fields are string keys (not component references) so this module
 * stays platform-agnostic — each app resolves the key to its own icon
 * library (lucide-react for web, lucide-react-native for mobile).
 */

export interface MarketingFeature {
  id: string;
  title: string;
  description: string;
  icon: string;
}

export interface DemoOrgRow {
  icon: string;
  label: string;
  value: string;
}

export interface DemoOrgStats {
  members: number;
  events: number;
  donations: string;
}

export interface DemoOrg {
  name: string;
  location: string;
  initials: string;
  stats: DemoOrgStats;
  rows: DemoOrgRow[];
}

export const BRAND_TAGLINE = "Built for teams that go the distance";

export const HERO_SUB_COPY =
  "Member directories, events, donations, philanthropy, and records — all in one place. Built for sports teams, students, clubs, and organizations of all kinds.";

export const DEMO_ORG: DemoOrg = {
  name: "South Rock Ridge High School",
  location: "Central Pennsylvania",
  initials: "SR",
  stats: {
    members: 127,
    events: 24,
    donations: "$8.2k",
  },
  rows: [
    { icon: "users", label: "Member Directory", value: "48 active • 79 alumni" },
    { icon: "calendar", label: "Upcoming", value: "Spring Regatta - Mar 15" },
    { icon: "trophy", label: "Recent Award", value: "Conference Champions 2025" },
  ],
};

export const FEATURES: MarketingFeature[] = [
  {
    id: "roster",
    title: "Roster Management",
    description:
      "Maintain a living history of every athlete, coach, and alumni who's ever worn the jersey.",
    icon: "users",
  },
  {
    id: "events",
    title: "Team Events",
    description:
      "Coordinate game days, banquets, alumni games, and fundraisers with RSVP tracking.",
    icon: "calendar",
  },
  {
    id: "fundraising",
    title: "Fundraising",
    description:
      "Accept donations for new equipment or travel expenses directly to your team's Stripe account.",
    icon: "dollar-sign",
  },
  {
    id: "records",
    title: "Record Books",
    description:
      "Preserve your team's history with digital trophy cases, record boards, and hall of fame.",
    icon: "trophy",
  },
  {
    id: "communication",
    title: "Communication",
    description:
      "Blast updates to parents, current players, and alumni without managing messy email lists.",
    icon: "message-square",
  },
  {
    id: "forms",
    title: "Digital Forms",
    description:
      "Collect liability waivers, medical forms, and registration docs securely online.",
    icon: "file-text",
  },
];
