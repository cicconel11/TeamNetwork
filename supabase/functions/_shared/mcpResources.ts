import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

export interface McpResource {
  uri: string;
  title: string;
  description: string;
  mime_type: string;
  category: string;
  body: string;
  metadata: Record<string, unknown>;
  updated_at: string;
}

/** List all resources (lightweight, no body). */
export async function listResources(): Promise<
  Pick<McpResource, "uri" | "title" | "description" | "mime_type">[]
> {
  const { data, error } = await supabase
    .from("mcp_resources")
    .select("uri, title, description, mime_type")
    .order("title");

  if (error) throw new Error(`listResources: ${error.message}`);
  return data;
}

/** Read a single resource by URI. */
export async function readResource(
  uri: string
): Promise<McpResource | null> {
  const { data, error } = await supabase
    .from("mcp_resources")
    .select("*")
    .eq("uri", uri)
    .maybeSingle();

  if (error) throw new Error(`readResource: ${error.message}`);
  return data;
}

/** Load resources by URIs and/or category (max 5). */
export async function loadResources(opts: {
  uris?: string[];
  category?: string;
}): Promise<McpResource[]> {
  let query = supabase.from("mcp_resources").select("*");

  if (opts.uris && opts.uris.length > 0) {
    query = query.in("uri", opts.uris);
  }
  if (opts.category) {
    query = query.eq("category", opts.category);
  }

  const { data, error } = await query.order("title").limit(5);

  if (error) throw new Error(`loadResources: ${error.message}`);
  return data;
}
