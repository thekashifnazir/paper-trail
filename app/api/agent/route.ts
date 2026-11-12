// POST /api/agent?month=2026-09[&concurrency=20][&replay=results/2026-09.json]
// Pass 3 for the month's open lines: live (Jev first when TYPESAFE_API_KEY is set, then Grok on XAI_API_KEY) or
// replayed from a saved run (instant; also via CASH_AGENT_REPLAY=1). Every answer goes through propose().
import { agentAvailable, agentRun, replayFor } from "@/lib/cash/agentRun";
import { handle } from "@/lib/cash/http";
import { store } from "@/lib/cash/service";

export const maxDuration = 300;

export async function POST(req: Request) {
  const q = new URL(req.url).searchParams;
  const month = q.get("month") ?? undefined;
  const replay = replayFor(month, q.get("replay"));
  if (!agentAvailable(replay)) return Response.json({ error: "XAI_API_KEY is not set on the server (or pass ?replay=results/YYYY-MM.json)" }, { status: 500 });
  return handle(() => agentRun(store(), { month, replay, concurrency: Number(q.get("concurrency") ?? 20) || 20 }));
}
