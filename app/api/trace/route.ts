// GET /api/trace: the last 50 Live (Supabase) requests this server instance handled, newest first: phase timings
// (wait for the write lock, load, compute, save), Supabase round trips, and the engine's decisions in that request
// (pass counts, agent proposals with confidence, reasoning and rejected evidence, lines sent to a person and why,
// approvals, payers learned, siblings cleared). Per instance: on Vercel, concurrent requests may land elsewhere;
// every trace is also one "[db]" line in the function logs. ?route=run filters by route name.
import { recentTraces } from "@/lib/supabase-store";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const want = new URL(req.url).searchParams.get("route")?.toLowerCase();
  const traces = recentTraces().filter((t) => !want || t.route.toLowerCase().includes(want));
  return Response.json({ instance_traces: traces.length, traces });
}
