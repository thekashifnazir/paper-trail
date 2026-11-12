// GET /api/summary?month=2026-09: the UI's RunSummary (lines and value by method, queue, score when known).
import { handle } from "@/lib/cash/http";
import { store } from "@/lib/cash/service";
import { runSummary } from "@/lib/cash/view";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const month = new URL(req.url).searchParams.get("month") ?? undefined;
  return handle(() => runSummary(store(), month));
}
