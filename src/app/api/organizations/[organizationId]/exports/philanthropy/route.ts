import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { baseSchemas } from "@/lib/security/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

type PhilanthropyEventRow = {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  location: string | null;
  description: string | null;
  audience: string | null;
  event_type: string | null;
  is_philanthropy: boolean | null;
  created_at: string | null;
  updated_at: string | null;
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
    return NextResponse.json({ error: "Unauthorized", message: "You must be logged in to export philanthropy." }, { status: 401 });
  }

  const { data: role } = await supabase
    .from("user_organization_roles")
    .select("role,status")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (role?.role !== "admin" || role.status === "revoked") {
    return NextResponse.json({ error: "Forbidden", message: "Only admins can export philanthropy." }, { status: 403 });
  }

  const serviceClient = createServiceClient();
  const { data: events, error } = await serviceClient
    .from("events")
    .select("id, title, start_date, end_date, location, description, audience, event_type, is_philanthropy, created_at, updated_at")
    .eq("organization_id", organizationId)
    .or("is_philanthropy.eq.true,event_type.eq.philanthropy")
    .order("start_date", { ascending: false });

  if (error) {
    console.error("[philanthropy-export] Failed to fetch events:", error);
    return NextResponse.json({ error: "Database error", message: "Failed to export philanthropy." }, { status: 500 });
  }

  const rows = (events || []) as PhilanthropyEventRow[];
  const headers = [
    "Event ID",
    "Title",
    "Start Date",
    "End Date",
    "Location",
    "Description",
    "Audience",
    "Event Type",
    "Is Philanthropy",
    "Created At",
    "Updated At",
  ];

  const csvRows = rows.map((event) => [
    event.id,
    event.title || "",
    event.start_date || "",
    event.end_date || "",
    event.location || "",
    event.description || "",
    event.audience || "",
    event.event_type || "",
    event.is_philanthropy ? "Yes" : "No",
    event.created_at || "",
    event.updated_at || "",
  ]);

  const csv = buildCsv(headers, csvRows);
  const fileName = `philanthropy-${organizationId}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
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
