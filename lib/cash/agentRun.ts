// Pass 3 for a month's open lines, shared by POST /api/agent and POST /api/run: replayed from a saved run, or live
// (Jev first when TYPESAFE_API_KEY is set, then Grok on XAI_API_KEY). Every answer goes through propose(); lines
// with no usable answer are queued for a person.
import { modelName, pass3Input, type Pass3Result } from "./agent";
import { candidates } from "./candidates";
import { pass3Mode, runPass3 } from "./pass3";
import { loadReplay } from "./replay";
import { openAmounts, openLines, propose, queueForPerson, type Store } from "./service";

export interface AgentRunOptions { month?: string; replay?: string | null; concurrency?: number }

export const replayFor = (month?: string, explicit?: string | null) =>
  explicit ?? (process.env.CASH_AGENT_REPLAY === "1" && month ? `results/${month}.json` : null);

export const agentAvailable = (replay: string | null) => Boolean(replay || process.env.XAI_API_KEY);

export async function agentRun(s: Store, o: AgentRunOptions) {
  const t0 = Date.now();
  const replay = replayFor(o.month, o.replay);
  const concurrency = Math.max(1, Math.min(50, o.concurrency ?? 20));
  const lines = openLines(s, o.month);
  let results: (Pass3Result & { via?: string })[];
  if (replay) {
    const saved = loadReplay(replay);
    results = lines.map((b) => saved.get(b.id) ?? { bank_line_id: b.id, proposal: null, tries: 0, rejected: [`not in ${replay}`] });
  } else {
    const key = process.env.XAI_API_KEY;
    if (!key) throw new Error("XAI_API_KEY is not set on the server (or replay a saved run)");
    const open = openAmounts(s);
    const aliases = s.aliases.map((a) => ({ payer_name: a.payer_name, tenant_id: a.tenant_id }));
    const inputs = lines.map((b) => pass3Input(candidates(b, s.charges, open, s.tenants, aliases, s.bankLines), s.tenants, s.notes, s.lookup));
    results = await runPass3(inputs, open, { apiKey: key, model: modelName() }, { mode: pass3Mode(), jevKey: process.env.TYPESAFE_API_KEY, concurrency });
  }
  const out = {
    source: replay ? `replay ${replay}` : pass3Mode() === "jev_then_grok" ? `Jev, then xAI ${modelName()}` : `xAI ${modelName()}`,
    concurrency: replay ? null : concurrency, lines: lines.length,
    jev_settled: 0, jev_to_a_person: 0, sent_to_grok: 0,
    allocated: 0, waiting_for_approval: 0, held: 0, evidence_checked: 0, evidence_rejected: 0,
    to_a_person: [] as { bank_line_id: string; reasons: string[] }[], seconds: 0,
  };
  for (const r of results) {
    if (r.via === "jev") out.jev_settled++;
    else if (r.via === "jev_person") out.jev_to_a_person++;
    else if (r.via === "grok") out.sent_to_grok++;
    if (!r.proposal) {
      out.to_a_person.push({ bank_line_id: r.bank_line_id, reasons: r.rejected });
      queueForPerson(s, r.bank_line_id, r.rejected.join("; ") || "no usable answer", "system");
      continue;
    }
    try {
      const res = propose(s, { ...r.proposal, bank_line_id: r.bank_line_id }, "grok_bot");
      if (res.status === "held") out.held++;
      else if (res.status === "proposed") out.waiting_for_approval++;
      else out.allocated++;
      if ("evidence_checked" in res) { out.evidence_checked += res.evidence_checked ?? 0; out.evidence_rejected += res.evidence_rejected?.length ?? 0; }
    } catch (e) {
      const reasons = [...r.rejected, e instanceof Error ? e.message : String(e)];
      out.to_a_person.push({ bank_line_id: r.bank_line_id, reasons });
      queueForPerson(s, r.bank_line_id, reasons.join("; "), "system");
    }
  }
  out.seconds = Math.round((Date.now() - t0) / 100) / 10;
  return out;
}
