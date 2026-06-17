import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { PageHeader } from "@/components/layout";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrgDataHealth } from "@/lib/health/org-data-health";

interface DataHealthPageProps {
  params: Promise<{ orgSlug: string }>;
}

type Tone = "good" | "warn" | "bad";

function toneClasses(tone: Tone): string {
  switch (tone) {
    case "good":
      return "bg-green-100 text-green-800";
    case "warn":
      return "bg-amber-100 text-amber-800";
    case "bad":
      return "bg-red-100 text-red-800";
  }
}

function StatePill({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${toneClasses(tone)}`}
    >
      {label}
    </span>
  );
}

function MetricRow({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-gray-600">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}

function Card({
  title,
  tone,
  state,
  children,
}: {
  title: string;
  tone: Tone;
  state: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <StatePill label={state} tone={tone} />
      </div>
      {children}
    </section>
  );
}

export default async function DataHealthPage({ params }: DataHealthPageProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization) return null;
  if (!orgCtx.isAdmin) redirect(`/${orgSlug}`);

  const serviceSupabase = createServiceClient();
  const report = await getOrgDataHealth(serviceSupabase, orgCtx.organization.id);

  const ragTone: Tone =
    report.rag.state === "ok" ? "good" : report.rag.state === "degraded" ? "bad" : "warn";
  const enrichTone: Tone =
    report.enrichment.state === "ok"
      ? "good"
      : report.enrichment.state === "degraded"
        ? "bad"
        : "warn";

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Data health"
        description="Read-only correctness checks across the assistant's RAG index and LinkedIn enrichment. Counts show divergence between live data and each pipeline."
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="RAG index" tone={ragTone} state={report.rag.state}>
          <MetricRow label="Missing coverage" value={report.rag.counts.missingCoverage} />
          <MetricRow label="Orphan chunks" value={report.rag.counts.orphanChunks} />
          <MetricRow label="Stale sources" value={report.rag.counts.staleSources} />
          <MetricRow label="Untagged audience" value={report.rag.counts.untaggedAudience} />
        </Card>

        <Card title="Enrichment tagging" tone={enrichTone} state={report.enrichment.state}>
          <MetricRow label="Userless member rows" value={report.enrichment.counts.userlessRows} />
          <MetricRow
            label="Permanently failed"
            value={report.enrichment.counts.permanentlyFailed}
          />
          <MetricRow label="Stalled runs" value={report.enrichment.counts.stalledRuns} />
          <MetricRow label="Pre-provenance rows" value={report.enrichment.counts.preProvenance} />
        </Card>
      </div>
    </div>
  );
}
