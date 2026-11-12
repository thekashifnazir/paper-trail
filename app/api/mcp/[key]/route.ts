import { handleMcp } from "@/lib/mcp/handler";

// Same connector with the token in the path: /api/mcp/<MCP_TOKEN>. Grok Bot's custom connector drops ?key=.
export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  return handleMcp(req, (await ctx.params).key);
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
