export interface BlogSection {
  heading?: string;
  paragraphs: string[];
}

export interface BlogPost {
  slug: string;
  title: string;
  date: string;
  category: string;
  excerpt: string;
  readingTime: string;
  sections: BlogSection[];
}

export const blogPosts: BlogPost[] = [
  {
    slug: "alumni-network-broken",
    title: "Your Alumni Network Is Broken. Here's the Data — and the Fix.",
    date: "2026-04-10",
    category: "Research",
    excerpt:
      "According to a Strada-Gallup survey, just 9% of graduates say their alumni network has been helpful to their career. The problem isn't willingness — it's infrastructure.",
    readingTime: "8 min read",
    sections: [
      {
        paragraphs: [
          "Every program, team, and school tells its members the same thing at some point: the network will open doors for you. It's one of the most enduring promises in education and organized community life. Stay connected. Give back. Look out for each other.",
          "The problem is that for most programs, the infrastructure to actually deliver on that promise simply does not exist.",
          "The research makes this uncomfortably clear.",
        ],
      },
      {
        heading: "The Gap Between Promise and Reality",
        paragraphs: [
          "According to a Strada-Gallup Alumni Survey of more than 5,100 respondents, just 9% of graduates say their alumni network has been helpful or very helpful to their career. Read that again. Nine percent. At institutions that spend considerable resources recruiting students in part on the strength of their alumni communities, fewer than one in ten graduates say those communities actually delivered.",
          "More than two-thirds of respondents — 69% — said their networks were neither helpful nor unhelpful. Another 22% said they had been unhelpful or very unhelpful.",
          "These aren't the numbers of a system that's slightly underperforming. They're the numbers of a system that has largely failed to bridge the gap between the people who graduated and the people still in the program.",
          "The failure is not for lack of willing alumni. When institutions actually organize their graduates around a shared purpose, the results speak for themselves. At the University of Chicago, 550 alumni volunteered through career services in a single academic year during the economic crisis of 2009, helping provide 25% of all job and internship opportunities for graduating students that year. The alumni were there. They wanted to help. The difference was infrastructure — someone had organized the connection.",
          "That's the core of the problem. It is not a willingness problem. It is a systems problem.",
        ],
      },
      {
        heading: "Social Capital Is Lying Dormant",
        paragraphs: [
          "The Clayton Christensen Institute, one of the leading research organizations studying innovation in education, identified this gap clearly in its landmark report on alumni networks. Alumni bases hold a critical stock of social capital, currently lying dormant across much of the system.",
          "Endowment-supported institutions have long-held, elaborate strategies in place to \"engage\" alumni to mine their financial capital. But they — and their peer institutions with smaller or no endowments — could be doing more to successfully activate alumni's social capital.",
          "This is the distinction that most organizations miss entirely. Programs know how to ask alumni for donations. They send newsletters. They plan reunions. They measure giving rates. What they rarely do is build structured, scalable pathways for alumni to become mentors, advisors, connectors, and advocates for the people still in the program.",
          "The Christensen Institute report found that alumni hold potential across four distinct functions that most programs leave untapped: mentors to drive persistence and student success; sources of career advice, inspiration, and referrals; providers of experiential learning and internships; and part-time staff for program delivery.",
          "Nearly every program has alumni who could fulfill one or more of these roles today. The gap is not the people. It is the platform to connect them.",
        ],
      },
      {
        heading: "The Mentorship Gap Is Especially Urgent",
        paragraphs: [
          "Gallup's research found that many institutions know how to mobilize their alumni for donations, but few throw that same energy behind alumni-student mentorship programs.",
          "This matters because the consequences are measurable. Students who have mentors in college demonstrate greater academic achievement and career development, yet they are lacking in higher education. Only one-quarter of college students said they \"strongly agree\" they had a mentor who encouraged them to go after their goals.",
          "For youth sports programs, after-school organizations, and community programs, this problem is even more acute. These communities often lack the formal career services infrastructure that universities — however imperfectly — at least attempt to provide. A young person who went through a program, found their confidence there, and now needs guidance as they navigate their next steps has no formal mechanism to connect with the adults who came before them through that same program.",
          "The alumni who could mentor them exist. They graduated from the same program. They know what it means to be there. They often want to give back. But there is no system to find them, no directory to search, no platform to facilitate the introduction — and no way to keep that relationship alive over time.",
        ],
      },
      {
        heading: "The Infrastructure Has Never Existed — Until Now",
        paragraphs: [
          "A range of technology tools and new alumni engagement models are starting to emerge that could help institutions change course, taking the chance out of chance encounters between students and alumni.",
          "That is precisely what TeamNetwork was built to do.",
          "We believe the relationship between a program and its members should never end at graduation. The problem the research identifies — dormant social capital, disorganized alumni, no structured mentorship pathways, communities that go dark the moment someone leaves — is the exact problem TeamNetwork solves.",
          "TeamNetwork gives every program, team, and organization a living alumni platform: a searchable directory that grows over time, structured mentorship matching that connects alumni to current members, fundraising and donation tools, event management for reunions and giving days, and long-term communication infrastructure that keeps the community active not just during the season but for years after graduation.",
          "The difference between the 9% who found their alumni network genuinely helpful and the 91% who didn't is not luck. It is infrastructure. It is whether someone built a system to make the connection easy, consistent, and ongoing — rather than leaving it to chance.",
          "Every program deserves that system. Every alumnus who wants to give back deserves a simple way to do it. Every current member deserves access to the people who walked the same path before them.",
          "That is what TeamNetwork makes possible.",
        ],
      },
      {
        paragraphs: [
          "TeamNetwork is the alumni engagement platform built for every program, team, and community. Learn more at myteamnetwork.com.",
        ],
      },
    ],
  },
];

export function getPostBySlug(slug: string): BlogPost | undefined {
  return blogPosts.find((p) => p.slug === slug);
}

export function getAllSlugs(): string[] {
  return blogPosts.map((p) => p.slug);
}
