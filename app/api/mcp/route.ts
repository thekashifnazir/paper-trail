import { handleMcp } from "@/lib/mcp/handler";

// Grok Bot connector (MCP over HTTP). See lib/mcp/handler.ts.
export async function POST(req: Request) {
  return handleMcp(req);
}

// No server-to-client stream: tell clients to use POST only.
export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
