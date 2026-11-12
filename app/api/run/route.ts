// POST /api/run                passes 1 and 2 on every open line (as before).
// POST /api/run?month=2026-09  the UI's run: loads that month's statement from data/sample if it isn't loaded yet,
//                              runs passes 1 and 2, then pass 3 (replay when CASH_AGENT_REPLAY=1, else live when
//                              XAI_API_KEY is set), and returns the UI's RunSummary plus the pass counts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentAvailable, agentRun, replayFor } from "@/lib/cash/agentRun";
import { SAMPLE_DIR } from "@/lib/cash/data";
import { handle } from "@/lib/cash/http";
import { loadStatement, run, store } from "@/lib/cash/service";
import { runSummary } from "@/lib/cash/view";

export const maxDuration = 300;

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
    const replay = replayFor(month);
    const agent = passes.left_open && agentAvailable(replay) ? await agentRun(s, { month, replay }) : null;
    return { ...runSummary(s, month), ...passes, agent };
  });
}
