// POST /api/agent?month=2026-09: pass 3 on the xAI API for the open lines. Each answer goes through the same
// proposal check as Grok Bot's (sum to the penny, known charges, threshold). Needs XAI_API_KEY (server-side only).
import { modelName, pass3Input, proposeAll } from "@/lib/cash/agent";
import { candidates } from "@/lib/cash/candidates";
import { handle } from "@/lib/cash/http";
import { openAmounts, openLines, propose, store } from "@/lib/cash/service";

export const maxDuration = 300;

export async function POST(req: Request) {
  const month = new URL(req.url).searchParams.get("month") ?? undefined;
  const key = process.env.XAI_API_KEY;
  if (!key) return Response.json({ error: "XAI_API_KEY is not set on the server" }, { status: 500 });
  return handle(async () => {
    const s = store();
    const open = openAmounts(s);
    const aliases = s.aliases.map((a) => ({ payer_name: a.payer_name, tenant_id: a.tenant_id }));
    const lookup = s.tenants.filter((t) => t.parent_company).map((t) => ({ payer_name: t.parent_company, group_members: [t.tenant_name], source: "company lookup" }));
    const inputs = openLines(s, month).map((b) => pass3Input(candidates(b, s.charges, open, s.tenants, aliases, s.bankLines), s.tenants, s.notes, lookup));
    const results = await proposeAll({ apiKey: key, model: modelName() }, inputs, open);
    const out = { model: modelName(), lines: inputs.length, allocated: 0, waiting_for_approval: 0, held: 0, to_a_person: [] as { bank_line_id: string; reasons: string[] }[] };
    for (const r of results) {
      if (!r.proposal) { out.to_a_person.push({ bank_line_id: r.bank_line_id, reasons: r.rejected }); continue; }
      try {
        const res = propose(s, { ...r.proposal, bank_line_id: r.bank_line_id }, "grok_bot");
        if (res.status === "held") out.held++;
        else if (res.status === "proposed") out.waiting_for_approval++;
        else out.allocated++;
      } catch (e) {
        out.to_a_person.push({ bank_line_id: r.bank_line_id, reasons: [...r.rejected, e instanceof Error ? e.message : String(e)] });
      }
    }
    return out;
  });
}
