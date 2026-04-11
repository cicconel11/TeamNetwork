import {
  listResources,
  readResource,
  loadResources,
} from "../_shared/mcpResources.ts";

const TOOL_DEFINITIONS = [
  {
    name: "load_resources",
    description:
      "Load skill/knowledge resources. Use when the client does not support MCP resources natively.",
    inputSchema: {
      type: "object" as const,
      properties: {
        uris: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Specific resource URIs to load",
        },
        category: {
          type: "string" as const,
          description: "Filter by category (e.g. 'skill')",
        },
      },
    },
  },
];

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

function ok(id: string | number, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function err(id: string | number | null, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handleRequest(req: JsonRpcRequest): Promise<Response> {
  const { id, method, params } = req;

  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "teamnetwork-mcp", version: "0.1.0" },
        capabilities: {
          resources: {},
          tools: {},
        },
      });

    case "notifications/initialized":
      return ok(id, {});

    case "resources/list": {
      const resources = await listResources();
      return ok(id, {
        resources: resources.map((r) => ({
          uri: r.uri,
          name: r.title,
          description: r.description,
          mimeType: r.mime_type,
        })),
      });
    }

    case "resources/read": {
      const uri = (params as { uri?: string })?.uri;
      if (!uri) return err(id, -32602, "Missing required param: uri");

      const resource = await readResource(uri);
      if (!resource) return err(id, -32602, `Resource not found: ${uri}`);

      return ok(id, {
        contents: [
          {
            uri: resource.uri,
            mimeType: resource.mime_type,
            text: resource.body,
          },
        ],
      });
    }

    case "tools/list":
      return ok(id, { tools: TOOL_DEFINITIONS });

    case "tools/call": {
      const toolName = (params as { name?: string })?.name;
      const args = (params as { arguments?: Record<string, unknown> })
        ?.arguments ?? {};

      if (toolName !== "load_resources") {
        return err(id, -32602, `Unknown tool: ${toolName}`);
      }

      const results = await loadResources({
        uris: args.uris as string[] | undefined,
        category: args.category as string | undefined,
      });

      const text = results
        .map(
          (r) =>
            `# ${r.title}\nURI: ${r.uri}\nCategory: ${r.category}\n\n${r.body}`
        )
        .join("\n\n---\n\n");

      return ok(id, {
        content: [{ type: "text", text: text || "No matching resources found." }],
      });
    }

    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") {
    return err(null, -32600, "Only POST is supported");
  }

  try {
    const body = await req.json();
    return await handleRequest(body as JsonRpcRequest);
  } catch (e) {
    return err(null, -32700, `Parse error: ${(e as Error).message}`);
  }
});
