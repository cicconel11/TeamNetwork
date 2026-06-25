"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, Button } from "@/components/ui";
import { PageHeader } from "@/components/layout";

export default function NewDonationPage() {
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  return (
    <div className="animate-fade-in space-y-4">
      <PageHeader
        title="Record Contribution"
        description="Contributions are now processed via Stripe Checkout. Use the contribution form to start a payment."
        backHref={`/${orgSlug}/donations`}
      />

      <Card className="p-6 space-y-3">
        <p className="text-sm text-muted-foreground">
          Manual contribution recording has been replaced by real-time Stripe webhooks. Start a contribution from the Contributions or Team Funding pages to ensure totals and counts stay in sync automatically.
        </p>
        <div className="flex gap-3">
          <Link href={`/${orgSlug}/donations`}>
            <Button>Go to Contributions</Button>
          </Link>
          <Link href={`/${orgSlug}/philanthropy`}>
            <Button variant="secondary">Team Funding</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
