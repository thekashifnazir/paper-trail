// Replay a saved pass 3 run (results/<month>.json from scripts/pass3.ts --save) instead of calling xAI, so a demo
// answers instantly. The saved answers still go through propose(): sum check, evidence check, threshold.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pass3Result } from "./agent";
import type { AgentProposal } from "./types";

export function replayFile(name: string): string {
  if (!/^results\/\d{4}-\d{2}\.json$/.test(name)) throw new Error(`replay must name results/YYYY-MM.json, got ${JSON.stringify(name)}`);
  return join(process.cwd(), name);
}

export function loadReplay(name: string): Map<string, Pass3Result> {
  const saved: { lines: { bank_line_id: string; method: string; allocations: AgentProposal["allocations"]; unallocated_amount: number; confidence: number | null; reasoning?: string | null; evidence?: AgentProposal["evidence"]; code_rejections?: string[] }[] } =
    JSON.parse(readFileSync(replayFile(name), "utf8"));
  const out = new Map<string, Pass3Result>();
  for (const l of saved.lines) {
    if (l.method !== "agent") continue;
    const proposal: AgentProposal | null = l.confidence === null ? null : { allocations: l.allocations, unallocated_amount: l.unallocated_amount, confidence: l.confidence, reasoning: l.reasoning ?? "", evidence: l.evidence ?? [] };
    out.set(l.bank_line_id, { bank_line_id: l.bank_line_id, proposal, tries: 0, rejected: l.code_rejections ?? [] });
  }
  return out;
}
