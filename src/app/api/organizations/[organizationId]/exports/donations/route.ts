import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { baseSchemas } from "@/lib/security/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

type DonationRow = {
  id: string;
  donor_name: string | null;
  donor_email: string | null;
  amount_cents: number;
  currency: string;
  purpose: string | null;
  status: string;
  created_at: string;
  event_id: string | null;
  events?: { title?: string | null } | null;
};

export async function GET(_request: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized", message: "You must be logged in to export donations." }, { status: 401 });
  }

  const { data: role } = await supabase
    .from("user_organization_roles")
    .select("role,status")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (role?.role !== "admin" || role.status === "revoked") {
    return NextResponse.json({ error: "Forbidden", message: "Only admins can export donations." }, { status: 403 });
  }

  const serviceClient = createServiceClient();
  const { data: donations, error } = await serviceClient
    .from("organization_donations")
    .select("id, donor_name, donor_email, amount_cents, currency, purpose, status, created_at, event_id, events(title)")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[donations-export] Failed to fetch donations:", error);
    return NextResponse.json({ error: "Database error", message: "Failed to export donations." }, { status: 500 });
  }

  const rows = (donations || []) as DonationRow[];
  const headers = [
    "Donation ID",
    "Donor Name",
    "Donor Email",
    "Amount",
    "Currency",
    "Purpose",
    "Status",
    "Date",
    "Event ID",
    "Event Title",
  ];

  const csvRows = rows.map((donation) => [
    donation.id,
    donation.donor_name || "",
    donation.donor_email || "",
    formatCurrency(donation.amount_cents, donation.currency),
    donation.currency || "",
    donation.purpose || "",
    donation.status || "",
    donation.created_at ? new Date(donation.created_at).toISOString() : "",
    donation.event_id || "",
    donation.events?.title || "",
  ]);

  const csv = buildCsv(headers, csvRows);
  const fileName = `donations-${organizationId}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

function formatCurrency(amountCents: number, currency: string) {
  const amount = (amountCents || 0) / 100;
  if (!currency) return amount.toFixed(2);

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

function buildCsv(headers: string[], rows: string[][]) {
  return [
    headers.map(escapeCsv).join(","),
    ...rows.map((row) => row.map(escapeCsv).join(",")),
  ].join("\n");
}

function escapeCsv(value: string) {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
