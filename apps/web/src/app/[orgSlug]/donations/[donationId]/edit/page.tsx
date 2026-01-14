"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, Button } from "@/components/ui";
import { PageHeader } from "@/components/layout";

export default function EditDonationPage() {
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  return (
    <div className="animate-fade-in space-y-4">
      <PageHeader
        title="Donation Details"
        description="Stripe now owns the source of truth for donations. Manage refunds or edits from the Stripe Dashboard."
        backHref={`/${orgSlug}/donations`}
      />

      <Card className="p-6 space-y-3">
        <p className="text-sm text-muted-foreground">
          Donation rows are written automatically from Stripe webhooks. To adjust amounts or cancel a payment, use the Stripe Dashboard for the organization&apos;s connected account.
        </p>
        <Link href={`/${orgSlug}/donations`}>
          <Button>Back to Donations</Button>
        </Link>
      </Card>
    </div>
  );
}



