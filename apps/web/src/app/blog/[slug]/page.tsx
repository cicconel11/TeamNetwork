import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui";
import { Container } from "@/components/marketing/Container";
import { Section } from "@/components/marketing/Section";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { getPostBySlug, getAllSlugs } from "@/lib/blog/posts";
import "../../landing-styles.css";

export const revalidate = 3600;

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return { title: "Post Not Found | TeamNetwork" };
  return {
    title: `${post.title} | TeamNetwork Blog`,
    description: post.excerpt,
  };
}

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  return (
    <MarketingShell>
      <Section padY="lg">
        <Container size="sm" as="section">
          <article>
            {/* Meta */}
            <div className="mb-10">
              <Link
                href="/blog"
                className="group mb-8 flex w-max items-center gap-1.5 text-sm text-landing-cream/55 transition-colors hover:text-landing-cream"
              >
                <svg
                  className="h-4 w-4 transition-transform group-hover:-translate-x-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                </svg>
                All posts
              </Link>

              <div className="eyebrow-label mb-5">{post.category}</div>

              <h1 className="display-section text-landing-cream">{post.title}</h1>

              <div className="mt-5 flex items-center gap-4 text-sm text-landing-cream/40">
                <time dateTime={post.date}>{formatDate(post.date)}</time>
                <span className="h-1 w-1 rounded-full bg-landing-cream/20" />
                <span>{post.readingTime}</span>
              </div>
            </div>

            {/* Divider */}
            <div className="mb-10 h-px bg-gradient-to-r from-transparent via-landing-cream/10 to-transparent" />

            {/* Content */}
            <div className="blog-prose">
              {post.sections.map((section, i) => (
                <section key={i}>
                  {section.heading && <h2 className="font-display">{section.heading}</h2>}
                  {section.paragraphs.map((p, j) => (
                    <p key={j}>{p}</p>
                  ))}
                </section>
              ))}
            </div>

            {/* CTA */}
            <div className="mt-16 border-t border-white/10 pt-10 text-center">
              <p className="mb-5 text-sm text-landing-cream/50">
                Ready to build your alumni network?
              </p>
              <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
                <ButtonLink href="/contact" variant="landingPrimary" size="lg">
                  Contact Sales
                </ButtonLink>
                <ButtonLink href="/demos" variant="landingSecondary" size="lg">
                  See a Demo
                </ButtonLink>
              </div>
            </div>
          </article>
        </Container>
      </Section>
    </MarketingShell>
  );
}
