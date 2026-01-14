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
    question: "Is this built for high school programs?",
    answer: "Yes. TeamNetwork is designed specifically for high school sports teams, booster clubs, and alumni associations that need to bridge the gap between current seasons and past generations.",
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
];
