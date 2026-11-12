// POST /api/run                passes 1 and 2 on every open line (as before).
// POST /api/run?month=2026-09  the UI's run: loads that month's statement from data/sample if it isn't loaded yet,
//                              runs passes 1 and 2, then pass 3 replayed from results/<month>.json (the saved real
//                              run, instant) when that file exists, and returns the UI's RunSummary plus the pass
//                              counts. Live pass 3 (Jev, then Grok) is POST /api/agent; Grok Bot uses /api/mcp.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { agentRun } from "@/lib/cash/agentRun";
import { SAMPLE_DIR } from "@/lib/cash/data";
import { handle } from "@/lib/cash/http";
import { loadStatement, run, store } from "@/lib/cash/service";
import { runSummary } from "@/lib/cash/view";

export async function POST(req: Request) {
  const month = new URL(req.url).searchParams.get("month") ?? undefined;
  return handle(async () => {
    const s = store();
    if (!month) return run(s);
    if (!/^\d{4}-\d{2}$/.test(month) || month === "2026-11") throw new Error(`month ${month} is not a demo month`);
    if (!s.bankLines.some((b) => (b.statement_month ?? b.date.slice(0, 7)) === month)) {
      loadStatement(s, readFileSync(join(SAMPLE_DIR, `bank_${month.replace("-", "_")}.csv`), "utf8"), "system");
    }
    const passes = run(s, month);
    const replay = `results/${month}.json`;
    const agent = passes.left_open && existsSync(join(process.cwd(), replay)) ? await agentRun(s, { month, replay }) : null;
    return { ...runSummary(s, month), ...passes, agent };
  });
}
