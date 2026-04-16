import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui";
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
    <div
      id="top"
      className="landing-page min-h-screen text-landing-cream relative noise-overlay bg-landing-navy"
    >
      {/* Background */}
      <div className="fixed inset-0 stripe-pattern pointer-events-none" />
      <div className="fixed inset-0 bg-gradient-to-b from-landing-navy via-landing-navy to-landing-navy/95 pointer-events-none" />

      {/* Header */}
      <header className="relative z-20 sticky top-0 bg-landing-navy/95 backdrop-blur-md border-b border-landing-cream/10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="group flex items-center gap-2">
            <Image
              src="/TeamNetwor.png"
              alt=""
              width={541}
              height={303}
              sizes="28px"
              className="h-8 w-auto shrink-0 object-contain sm:h-7"
              aria-hidden="true"
            />
            <span className="font-display hidden text-base font-bold tracking-tight text-landing-cream sm:inline sm:text-xl">
              <span className="text-landing-green">Team</span>
              <span className="text-landing-cream">Network</span>
            </span>
            <span className="sr-only">TeamNetwork</span>
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm">
            <Link
              href="/blog"
              className="text-landing-cream/70 hover:text-landing-cream transition-colors flex items-center gap-1.5"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 19.5 8.25 12l7.5-7.5"
                />
              </svg>
              All Posts
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <ButtonLink
              href="/auth/login"
              variant="custom"
              className="text-landing-cream/80 hover:text-landing-cream hover:bg-landing-cream/10"
            >
              Sign In
            </ButtonLink>
            <ButtonLink
              href="/auth/signup"
              variant="custom"
              className="bg-landing-green-dark hover:bg-[#059669] text-white font-semibold px-5"
            >
              Get Started
            </ButtonLink>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <article className="max-w-3xl mx-auto px-6 pt-16 lg:pt-24 pb-24">
          {/* Meta */}
          <div className="mb-10">
            <Link
              href="/blog"
              className="md:hidden inline-flex items-center gap-1.5 text-sm text-landing-cream/50 hover:text-landing-cream transition-colors mb-6"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 19.5 8.25 12l7.5-7.5"
                />
              </svg>
              All Posts
            </Link>

            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-landing-green/10 text-landing-green text-xs font-medium mb-5">
              {post.category}
            </span>

            <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-[1.15] mb-5">
              {post.title}
            </h1>

            <div className="flex items-center gap-4 text-sm text-landing-cream/40">
              <time dateTime={post.date}>{formatDate(post.date)}</time>
              <span className="w-1 h-1 rounded-full bg-landing-cream/20" />
              <span>{post.readingTime}</span>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-landing-cream/10 mb-10" />

          {/* Content */}
          <div className="blog-prose">
            {post.sections.map((section, i) => (
              <section key={i}>
                {section.heading && (
                  <h2 className="font-display">{section.heading}</h2>
                )}
                {section.paragraphs.map((p, j) => (
                  <p key={j}>{p}</p>
                ))}
              </section>
            ))}
          </div>

          {/* CTA */}
          <div className="mt-16 pt-10 border-t border-landing-cream/10 text-center">
            <p className="text-landing-cream/50 text-sm mb-5">
              Ready to build your alumni network?
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <ButtonLink
                href="/auth/signup"
                variant="custom"
                className="bg-landing-green-dark hover:bg-[#059669] text-white font-semibold px-8 py-3"
              >
                Get Started Free
              </ButtonLink>
              <ButtonLink
                href="/demos"
                variant="custom"
                className="bg-landing-cream/10 text-landing-cream hover:bg-landing-cream/20 border border-landing-cream/20 px-8 py-3"
              >
                See a Demo
              </ButtonLink>
            </div>
          </div>
        </article>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-landing-cream/10 py-12 bg-landing-navy">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded bg-landing-green-dark flex items-center justify-center">
                <span className="font-display font-bold text-white text-sm">
                  TN
                </span>
              </div>
              <span className="font-display font-bold">TeamNetwork</span>
            </div>

            <div className="flex items-center gap-8 text-sm text-landing-cream/50">
              <Link
                href="/terms"
                className="hover:text-landing-cream transition-colors"
              >
                Terms
              </Link>
              <Link
                href="/privacy"
                className="hover:text-landing-cream transition-colors"
              >
                Privacy
              </Link>
              <Link
                href="/#pricing"
                className="hover:text-landing-cream transition-colors"
              >
                Pricing
              </Link>
              <a
                href="mailto:support@myteamnetwork.com"
                className="hover:text-landing-cream transition-colors"
              >
                Contact
              </a>
            </div>

            <p className="text-sm text-landing-cream/30">
              &copy; {new Date().getFullYear()} TeamNetwork
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
