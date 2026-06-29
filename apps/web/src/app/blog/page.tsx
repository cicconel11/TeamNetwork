import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/marketing/Container";
import { Section, SectionEyebrow } from "@/components/marketing/Section";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { blogPosts } from "@/lib/blog/posts";
import "../landing-styles.css";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Blog | TeamNetwork",
  description:
    "Insights on alumni engagement, mentorship, and building lasting communities.",
};

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function BlogPage() {
  return (
    <MarketingShell>
      {/* Hero */}
      <Section padY="lg">
        <Container size="lg">
          <div className="max-w-2xl">
            <SectionEyebrow>Blog</SectionEyebrow>
            <h1 className="scroll-reveal display-section text-landing-cream">
              Insights &amp; <span className="accent-italic">research.</span>
            </h1>
            <p className="scroll-reveal mt-5 text-lg leading-relaxed text-landing-cream/55">
              Data-driven perspectives on alumni engagement, mentorship, and building communities
              that last beyond graduation.
            </p>
          </div>
        </Container>
      </Section>

      {/* Post list — de-boxed, hairline-divided */}
      <Section divider="top" padY="lg">
        <Container size="lg">
          <ul className="scroll-reveal border-t border-white/10">
            {blogPosts.map((post) => (
              <li key={post.slug} className="border-b border-white/10">
                <Link
                  href={`/blog/${post.slug}`}
                  className="group grid gap-4 py-8 transition-colors md:grid-cols-[1fr_auto] md:items-baseline md:gap-12"
                >
                  <div className="min-w-0">
                    <span className="eyebrow-label !mb-3">{post.category}</span>
                    <h2 className="font-display text-2xl font-bold leading-snug text-landing-cream transition-colors group-hover:text-landing-green">
                      {post.title}
                    </h2>
                    <p className="mt-3 max-w-2xl text-base leading-relaxed text-landing-cream/55">
                      {post.excerpt}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-landing-cream/40 md:flex-col md:items-end md:gap-2 md:text-right">
                    <time dateTime={post.date}>{formatDate(post.date)}</time>
                    <span className="hidden md:inline">{post.readingTime}</span>
                    <span className="inline-flex items-center gap-1 text-landing-cream/45 transition-colors group-hover:text-landing-cream">
                      Read
                      <svg
                        className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </Section>
    </MarketingShell>
  );
}
