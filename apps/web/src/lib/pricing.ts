import type { AlumniBucket, SubscriptionInterval } from "@/types/database";

export const BASE_PRICES = {
  month: 15,
  year: 150,
} as const;

export const ALUMNI_ADD_ON_PRICES: Record<Exclude<AlumniBucket, "none">, { month: number; year: number }> = {
  "0-250": { month: 10, year: 100 },
  "251-500": { month: 20, year: 200 },
  "501-1000": { month: 35, year: 350 },
  "1001-2500": { month: 60, year: 600 },
  "2500-5000": { month: 100, year: 1000 },
  "5000+": { month: 0, year: 0 },
};

export const ALUMNI_BUCKET_LABELS: Record<AlumniBucket, string> = {
  none: "No alumni access",
  "0-250": "0–250 alumni",
  "251-500": "251–500 alumni",
  "501-1000": "501–1,000 alumni",
  "1001-2500": "1,001–2,500 alumni",
  "2500-5000": "2,500–5,000 alumni",
  "5000+": "5,000+ alumni (custom)",
};

export function getTotalPrice(interval: SubscriptionInterval, alumniBucket: AlumniBucket): number | null {
  if (alumniBucket === "5000+") return null;
  const base = BASE_PRICES[interval];
  const addon = alumniBucket === "none" ? 0 : ALUMNI_ADD_ON_PRICES[alumniBucket][interval];
  return base + addon;
}

export function formatPrice(amount: number, interval: SubscriptionInterval): string {
  return interval === "month" ? `$${amount}/mo` : `$${amount}/yr`;
}

export const FEATURES = [
  { title: "Roster Management", description: "Maintain a living history of every athlete, coach, and alumni who's ever worn the jersey." },
  { title: "Team Events", description: "Coordinate game days, banquets, alumni games, and fundraisers with RSVP tracking." },
  { title: "Fundraising", description: "Accept donations for new equipment or travel expenses directly to your team's Stripe account." },
  { title: "Record Books", description: "Preserve your team's history with digital trophy cases, record boards, and hall of fame." },
  { title: "Communication", description: "Blast updates to parents, current players, and alumni without managing messy email lists." },
  { title: "Digital Forms", description: "Collect liability waivers, medical forms, and registration docs securely online." },
];

export const FAQ_ITEMS = [
  {
    question: "Who is TeamNetwork built for?",
    answer: "TeamNetwork is built for any organization that wants to stay connected — sports teams, Greek life chapters, clubs, volunteer groups, and alumni associations. Whether you're managing a high school booster club or a college fraternity, we bridge the gap between active members and alumni.",
  },
  {
    question: "Do you take a cut of our donations?",
    answer: "No. We charge a flat platform fee. You connect your own Stripe account, so 100% of donations (minus standard Stripe processing fees) go directly to your program.",
  },
  {
    question: "How does alumni pricing work?",
    answer: "The base plan covers your current roster and coaches. You only pay extra if you want to grant access to a large database of alumni for networking and fundraising purposes.",
  },
  {
    question: "Can booster clubs use this?",
    answer: "Absolutely. Booster clubs often use TeamNetwork to manage membership, collect dues, and coordinate volunteers while keeping alumni engaged with the program.",
  },
  {
    question: "Is student data secure?",
    answer: "Yes. We use enterprise-grade security (Supabase with Row-Level Security) to ensure current student data is protected and only accessible to authorized administrators.",
  },
  {
    question: "Can I cancel anytime?",
    answer: "Yes. You can cancel your subscription at any time from your organization settings. Your access continues through the end of the current billing period — no partial refunds, but no surprise charges either.",
  },
  {
    question: "Is there a free trial?",
    answer: "Every organization starts with a free trial — no credit card required. You can explore the full platform, invite members, and set up your community before committing to a paid plan.",
  },
  {
    question: "What happens to my data if I cancel?",
    answer: "Your data stays safe. After cancellation, your organization enters a read-only grace period so members can export what they need. We never delete your data without notice.",
  },
];
