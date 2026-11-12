// Thin glue between Next.js route handlers (Web Request/Response) and the service.
import { HttpError, hydrate, type Actor } from "./service";

export function actorOf(req: Request, fallback: Actor = "human"): Actor {
  const a = req.headers.get("x-actor");
  return a === "grok_bot" || a === "human" || a === "system" ? a : fallback;
}

export async function bodyOf(req: Request): Promise<unknown> {
  const text = await req.text();
  if ((req.headers.get("content-type") ?? "").includes("text/csv")) return text;
  try { return JSON.parse(text); } catch { return text; }
}

export async function handle(fn: () => unknown | Promise<unknown>): Promise<Response> {
  try {
    await hydrate(); // payer memory from Supabase, once per process
    return Response.json(await fn());
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
