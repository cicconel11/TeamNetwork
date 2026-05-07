import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { AdoptionRequestClient } from "./AdoptionRequestClient";

interface PageProps {
  params: Promise<{ orgSlug: string; requestId: string }>;
}

export default async function AdoptionRequestPage({ params }: PageProps) {
  const { orgSlug } = await params;
  const context = await getOrgContext(orgSlug);

  if (!context || !context.isAdmin) {
    notFound();
  }

  return <AdoptionRequestClient />;
}
