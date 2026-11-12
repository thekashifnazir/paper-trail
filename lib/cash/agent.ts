// Pass 3 on the xAI API: Grok proposes an allocation for one open line; code checks it to the penny.
// A rejected proposal gets one retry with the reason; a second failure goes to a person.
import type { CandidateSet } from "./candidates";
import { checkProposal } from "./checkSum";
import type { CompanyLookup, TenantNote } from "./data";
import { fmt, toPence } from "./money";
import type { AgentProposal, Pence, Tenant } from "./types";

export const XAI_URL = "https://api.x.ai/v1";

export const SYSTEM = `You allocate one bank receipt to a landlord's open tenant charges. You propose; code checks; a person approves.

Input (JSON): bank_line {id, date, amount, payer_name, reference}; candidates [open charges: {id, tenant_id, tenant_name, unit, type, period, amount_open, invoice_ref, due_date}]; tenants [{tenant_id, tenant_name, parent_company}]; company_lookup [{payer_name, group_members}]; tenant_notes [{tenant_id, date, note}]; earlier_identical_lines [ids of lines with the same payer, amount and reference].

Return only JSON:
{"allocations": [{"charge_id": "...", "amount": 0.00}], "unallocated_amount": 0.00, "confidence": 0.0,
 "reasoning": "one or two sentences", "evidence": [{"type": "bank_line|charge|tenant|lease|note", "ref": "...", "quote": "..."}]}

Rules:
1. Allocations plus unallocated_amount must equal the bank amount to the penny. Code rejects anything else.
2. Only allocate to charge ids in candidates. Never invent a charge, tenant or parent.
3. A payer named in company_lookup may pay its group members' charges. Cite the lookup row.
4. One payment can cover several charges of one tenant: oldest due first, unless the reference names the charges.
5. A short-pay where a tenant note records a dispute: allocate the undisputed charges in full, the rest to the disputed charge, cite the note.
6. An overpayment: allocate the charge in full and put the excess in unallocated_amount (credit on account).
7. earlier_identical_lines is not empty and the same charges were already paid: allocate nothing, reasoning "possible duplicate of <id>".
8. No tenant, lookup row or note fits the payer: allocate nothing, confidence 0. Leaving a line unallocated is a correct answer.
9. Confidence: 0.9+ only when the payer and the amount both fit; below 0.7 goes to a person.`;

export interface Pass3Input extends CandidateSet {
  tenants: Pick<Tenant, "tenant_id" | "tenant_name" | "parent_company">[];
  company_lookup: CompanyLookup[];
  tenant_notes: TenantNote[];
}

export function pass3Input(c: CandidateSet, tenants: Tenant[], notes: TenantNote[], lookup: CompanyLookup[]): Pass3Input {
  const rel = new Set(c.candidates.map((x) => x.tenant_id));
  return {
    ...c,
    candidates: c.candidates.map((x) => ({ ...x, amount_open: Number(fmt(x.amount_open)) })),
    tenants: tenants.filter((t) => rel.has(t.tenant_id)).map(({ tenant_id, tenant_name, parent_company }) => ({ tenant_id, tenant_name, parent_company })),
    company_lookup: lookup,
    tenant_notes: notes.filter((n) => rel.has(n.tenant_id)),
  };
}

export interface AgentConfig {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}

export async function pickModel(apiKey: string, f: typeof fetch = fetch): Promise<string> {
  if (process.env.XAI_MODEL) return process.env.XAI_MODEL;
  const r = await f(`${XAI_URL}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
  if (!r.ok) throw new Error(`xAI /models ${r.status}: ${await r.text()}`);
  const ids: string[] = ((await r.json()).data ?? []).map((m: { id: string }) => m.id);
  const pick = ids.find((id) => /grok/i.test(id) && !/image|vision|mini|fast/i.test(id)) ?? ids[0];
  if (!pick) throw new Error("xAI returned no models");
  return pick;
}

async function chat(cfg: AgentConfig, messages: { role: string; content: string }[]): Promise<string> {
  const f = cfg.fetch ?? fetch;
  const r = await f(`${XAI_URL}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: cfg.model, messages, temperature: 0, response_format: { type: "json_object" } }),
  });
  if (!r.ok) throw new Error(`xAI ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()).choices?.[0]?.message?.content ?? "";
}

export interface Pass3Result {
  bank_line_id: string;
  proposal: AgentProposal | null; // null: no valid answer after the retry -> a person
  tries: number;
  rejected: string[]; // reasons code gave
}

export async function proposeLine(cfg: AgentConfig, input: Pass3Input, openAmount: Map<string, Pence>): Promise<Pass3Result> {
  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: JSON.stringify(input) },
  ];
  const rejected: string[] = [];
  const allowed = new Map(input.candidates.map((c) => [c.id, openAmount.get(c.id)!]));
  for (let tries = 1; tries <= 2; tries++) {
    const text = await chat(cfg, messages);
    let p: AgentProposal;
    try {
      p = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      rejected.push("not JSON");
      messages.push({ role: "assistant", content: text }, { role: "user", content: "That was not valid JSON. Return only the JSON object." });
      continue;
    }
    const check = Array.isArray(p.allocations)
      ? checkProposal(toPence(input.bank_line.amount), { allocations: p.allocations, unallocated_amount: p.unallocated_amount ?? 0 }, allowed)
      : { ok: false, reason: "allocations must be an array" };
    if (check.ok) return { bank_line_id: input.bank_line.id, proposal: p, tries, rejected };
    rejected.push(check.reason!);
    messages.push({ role: "assistant", content: text }, { role: "user", content: `Rejected by code: ${check.reason}. Fix the arithmetic or the charge ids, never the evidence. Return only the JSON object.` });
  }
  return { bank_line_id: input.bank_line.id, proposal: null, tries: 2, rejected };
}

// Runs lines with a small concurrency limit.
export async function proposeAll(cfg: AgentConfig, inputs: Pass3Input[], openAmount: Map<string, Pence>, limit = 4): Promise<Pass3Result[]> {
  const out: Pass3Result[] = new Array(inputs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, inputs.length) }, async () => {
      while (next < inputs.length) {
        const i = next++;
        try {
          out[i] = await proposeLine(cfg, inputs[i], openAmount);
        } catch (e) {
          out[i] = { bank_line_id: inputs[i].bank_line.id, proposal: null, tries: 0, rejected: [e instanceof Error ? e.message : String(e)] };
        }
      }
    }),
  );
  return out;
}

// Test stand-in for the xAI API: answers each line from the answer key through the same request path
// (JSON in a chat completion, parsed, checked by code). `firstWrongBy` makes the first answer per line off by
// that many pence, to prove the reject-and-retry path.
export function stubFetch(truth: { bank_line_id: string; case: string; true_charge_ids: string; true_amounts: string; true_unallocated?: string }[], firstWrongBy = 0): typeof fetch {
  const byId = new Map(truth.map((t) => [t.bank_line_id, t]));
  const seen = new Set<string>();
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const input: Pass3Input = JSON.parse(body.messages[1].content);
    const t = byId.get(input.bank_line.id)!;
    const ids = t.true_charge_ids ? t.true_charge_ids.split(";") : [];
    const amts = t.true_amounts ? t.true_amounts.split(";") : [];
    const off = firstWrongBy && !seen.has(t.bank_line_id) ? firstWrongBy : 0;
    seen.add(t.bank_line_id);
    const p: AgentProposal = {
      allocations: ids.map((id, i) => ({ charge_id: id, amount: Number(amts[i]) })),
      unallocated_amount: Number(fmt(toPence(t.true_unallocated ?? "0") + off)),
      confidence: ids.length ? (t.case === "parent_payer" ? 0.6 : 0.95) : t.case === "duplicate" ? 0.9 : 0,
      reasoning: `stub: ${t.case}`,
      evidence: [{ type: "bank_line", ref: t.bank_line_id, quote: input.bank_line.reference }],
    };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(p) } }] }), { status: 200 });
  }) as typeof fetch;
}
