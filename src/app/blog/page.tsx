import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ButtonLink } from "@/components/ui";
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
              href="/#features"
              className="text-landing-cream/70 hover:text-landing-cream transition-colors"
            >
              Features
            </Link>
            <Link
              href="/#pricing"
              className="text-landing-cream/70 hover:text-landing-cream transition-colors"
            >
              Pricing
            </Link>
            <Link
              href="/demos"
              className="text-landing-cream/70 hover:text-landing-cream transition-colors"
            >
              Demo
            </Link>
            <Link
              href="/#faq"
              className="text-landing-cream/70 hover:text-landing-cream transition-colors"
            >
              FAQ
            </Link>
            <Link
              href="/blog"
              className="text-landing-cream transition-colors"
            >
              Blog
            </Link>
            <Link
              href="/terms"
              className="text-landing-cream/70 hover:text-landing-cream transition-colors"
            >
              Terms
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
        {/* Hero */}
        <section className="relative z-10 pt-20 lg:pt-28 pb-16 px-6">
          <div className="max-w-6xl mx-auto">
            <div className="hero-animate inline-flex items-center gap-2 px-4 py-2 rounded-full bg-landing-cream/10 border border-landing-cream/20 mb-6">
              <span className="w-2 h-2 rounded-full bg-landing-green" />
              <span className="text-landing-cream/80 text-sm font-medium">
                Blog
              </span>
            </div>
            <h1 className="hero-animate font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] mb-5 max-w-3xl">
              Insights &amp; Research
            </h1>
            <p className="hero-animate text-lg text-landing-cream/50 max-w-2xl leading-relaxed">
              Data-driven perspectives on alumni engagement, mentorship, and
              building communities that last beyond graduation.
            </p>
          </div>
        </section>

        {/* Post grid */}
        <section className="relative z-10 px-6 pb-24">
          <div className="max-w-6xl mx-auto">
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {blogPosts.map((post) => (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="blog-card group rounded-2xl border border-landing-cream/10 bg-landing-navy-light/40 p-7 flex flex-col"
                >
                  {/* Category */}
                  <span className="inline-flex self-start items-center gap-1.5 px-3 py-1 rounded-full bg-landing-green/10 text-landing-green text-xs font-medium mb-5">
                    {post.category}
                  </span>

                  {/* Title */}
                  <h2 className="font-display text-xl font-bold leading-snug mb-3 group-hover:text-landing-green transition-colors">
                    {post.title}
                  </h2>

                  {/* Excerpt */}
                  <p className="text-sm text-landing-cream/50 leading-relaxed mb-6 flex-1">
                    {post.excerpt}
                  </p>

                  {/* Footer */}
                  <div className="flex items-center justify-between text-xs text-landing-cream/35 pt-4 border-t border-landing-cream/5">
                    <time dateTime={post.date}>{formatDate(post.date)}</time>
                    <span>{post.readingTime}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
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
