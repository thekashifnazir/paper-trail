// POST /api/run                passes 1 and 2 on every open line (as before).
// POST /api/run?month=2026-09  the UI's run: loads that month's statement from data/sample if it isn't loaded yet,
//                              runs passes 1 and 2, then pass 3 replayed from results/<month>.json (the saved real
//                              run, instant, no model call) when that file exists, and returns the UI's RunSummary
//                              plus the pass counts. Live pass 3 (Jev, then Grok) is POST /api/agent.
// With Supabase configured the store is loaded from and written back to the database (lib/supabase-store.ts).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { agentRun } from "@/lib/cash/agentRun";
import { SAMPLE_DIR } from "@/lib/cash/data";
import { handle } from "@/lib/cash/http";
import { HttpError, loadStatement, run, store, type Store } from "@/lib/cash/service";
import { runSummary } from "@/lib/cash/view";
import { dbEnabled, withDb } from "@/lib/supabase-store";

export const maxDuration = 60;

async function runMonth(s: Store, month: string, view: () => Store = () => s) {
  if (!/^\d{4}-\d{2}$/.test(month) || month === "2026-11") throw new HttpError(400, `month ${month} is not a demo month`);
  if (!s.bankLines.some((b) => (b.statement_month ?? b.date.slice(0, 7)) === month)) {
    loadStatement(s, readFileSync(join(SAMPLE_DIR, `bank_${month.replace("-", "_")}.csv`), "utf8"), "system");
  }
  const passes = run(s, month);
  const replay = `results/${month}.json`;
  const agent = passes.left_open && existsSync(join(process.cwd(), replay)) ? await agentRun(s, { month, replay }) : null;
  return { ...runSummary(view(), month), ...passes, agent };
}

export async function POST(req: Request) {
  const month = new URL(req.url).searchParams.get("month") ?? undefined;
  if (dbEnabled()) {
    return withDb("POST /api/run", (s, ctx) => {
      if (!month) return run(s);
      ctx.touchMonth(month);
      return runMonth(s, month, ctx.view);
    }, month ? { write: true, month, audit: "decisions" } : { write: true });
  }
  return handle(async () => {
    const s = store();
    if (!month) return run(s);
    return runMonth(s, month);
  });
}
