// POST /api/agent?month=2026-09[&concurrency=20][&replay=results/2026-09.json]
// Pass 3 for the month's open lines, live on the xAI API (XAI_API_KEY, server-side only) or replayed from a saved
// run (instant; also via CASH_AGENT_REPLAY=1, which replays results/<month>.json). Every answer goes through
// propose(): sum to the penny, known charges, evidence found in its source, confidence threshold.
import { modelName, pass3Input, proposeAll, type Pass3Result } from "@/lib/cash/agent";
import { candidates } from "@/lib/cash/candidates";
import { handle } from "@/lib/cash/http";
import { loadReplay } from "@/lib/cash/replay";
import { openAmounts, openLines, propose, store } from "@/lib/cash/service";

export const maxDuration = 300;

export async function POST(req: Request) {
  const q = new URL(req.url).searchParams;
  const month = q.get("month") ?? undefined;
  const replay = q.get("replay") ?? (process.env.CASH_AGENT_REPLAY === "1" && month ? `results/${month}.json` : null);
  const concurrency = Math.max(1, Math.min(50, Number(q.get("concurrency") ?? 20) || 20));
  const key = process.env.XAI_API_KEY;
  if (!replay && !key) return Response.json({ error: "XAI_API_KEY is not set on the server (or pass ?replay=results/YYYY-MM.json)" }, { status: 500 });
  return handle(async () => {
    const t0 = Date.now();
    const s = store();
    const lines = openLines(s, month);
    let results: Pass3Result[];
    if (replay) {
      const saved = loadReplay(replay);
      results = lines.map((b) => saved.get(b.id) ?? { bank_line_id: b.id, proposal: null, tries: 0, rejected: [`not in ${replay}`] });
    } else {
      const open = openAmounts(s);
      const aliases = s.aliases.map((a) => ({ payer_name: a.payer_name, tenant_id: a.tenant_id }));
      const inputs = lines.map((b) => pass3Input(candidates(b, s.charges, open, s.tenants, aliases, s.bankLines), s.tenants, s.notes, s.lookup));
      results = await proposeAll({ apiKey: key!, model: modelName() }, inputs, open, concurrency);
    }
    const out = {
      source: replay ? `replay ${replay}` : `xAI ${modelName()}`, concurrency: replay ? null : concurrency, lines: lines.length,
      allocated: 0, waiting_for_approval: 0, held: 0, evidence_checked: 0, evidence_rejected: 0,
      to_a_person: [] as { bank_line_id: string; reasons: string[] }[], seconds: 0,
    };
    for (const r of results) {
      if (!r.proposal) { out.to_a_person.push({ bank_line_id: r.bank_line_id, reasons: r.rejected }); continue; }
      try {
        const res = propose(s, { ...r.proposal, bank_line_id: r.bank_line_id }, "grok_bot");
        if (res.status === "held") out.held++;
        else if (res.status === "proposed") out.waiting_for_approval++;
        else out.allocated++;
        if ("evidence_checked" in res) { out.evidence_checked += res.evidence_checked ?? 0; out.evidence_rejected += res.evidence_rejected?.length ?? 0; }
      } catch (e) {
        out.to_a_person.push({ bank_line_id: r.bank_line_id, reasons: [...r.rejected, e instanceof Error ? e.message : String(e)] });
      }
    }
    out.seconds = Math.round((Date.now() - t0) / 100) / 10;
    return out;
  });
}
