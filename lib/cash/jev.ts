// Jev (TypeSafe System One) as the matcher before Grok: one request per open line after passes 1 and 2.
// Jev judges which candidate charge the receipt pays and what shape the payment has; code does the arithmetic
// (Jev is not a calculator) and decides: allocate, leave open for a person, or fall through to Grok.
// PASS3_MODE=jev_then_grok turns it on; the default stays grok until this path shows 0 wrong on Sep + Oct.
import type { Pass3Input } from "./agent";
import { fmt, toPence } from "./money";
import type { AgentProposal, Pence } from "./types";

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const jevModel = () => process.env.JEV_MODEL ?? "jev-1.14.0";

// Thresholds picked on Sep + Oct (scripts/jev-tune.ts), never on the hold-out.
export const JEV_T = { charge: 0.9, shape: 0.9, fitsYes: 0.7, fitsNo: 0.3, personSure: 0.9 };

export const SHAPES = {
  one_charge: "pays one charge, maybe with a little extra or a little less",
  several_charges: "covers or splits across more than one charge",
  duplicate: "repeats an earlier payment already received (see earlier_identical_lines)",
  unknown: "the payer is not one of the tenants, directly or through a listed parent company",
};

export interface JevAnswers {
  charge: { choice: string; confidence: number; probabilities: Record<string, number> };
  shape: { choice: keyof typeof SHAPES; confidence: number; probabilities: Record<string, number> };
  any_fits: { noul: number };
}

// State holds the bank line's own fields only (never an answer-key column), its candidates, lookup and notes.
export function jevRequest(input: Pass3Input) {
  const b = input.bank_line;
  const criteria: Record<string, string> = {};
  for (const c of input.candidates) criteria[c.id] = `${c.tenant_name} · ${c.type} ${c.period} · open £${Number(c.amount_open).toFixed(2)} · ${c.invoice_ref}`;
  criteria.none = "none of these charges is paid by this receipt";
  return {
    model: jevModel(),
    state: {
      bank_line: { id: b.id, date: b.date, amount: b.amount, payer_name: b.payer_name, reference: b.reference },
      candidates: input.candidates.map((c) => ({ id: c.id, tenant_name: c.tenant_name, type: c.type, period: c.period, amount_open: Number(c.amount_open).toFixed(2), invoice_ref: c.invoice_ref, due_date: c.due_date })),
      company_lookup: input.company_lookup.map((l) => ({ payer_name: l.payer_name, group_members: l.group_members })),
      tenant_notes: input.tenant_notes,
      earlier_identical_lines: input.earlier_identical_lines,
    },
    questions: {
      charge: { type: "choice", instructions: "Which open charge in candidates does this bank receipt pay? Match the payer (directly, or as a parent company in company_lookup), the reference and the amount.", criteria },
      shape: { type: "choice", instructions: "What shape does this bank receipt have against the candidate charges?", criteria: SHAPES },
      any_fits: {
        type: "noul",
        instructions: "Is the payer one of the tenants in candidates, directly or as a parent company listed in company_lookup?",
        criteria: { true: "the payer name is a candidate tenant (allowing for a name cut short by the bank) or a parent company that company_lookup lists for one", false: "the payer is a person or company that matches no candidate tenant and no company_lookup row" },
      },
    },
  };
}

export async function askJev(input: Pass3Input, apiKey: string, f: typeof fetch = fetch): Promise<JevAnswers> {
  const r = await f(JEV_URL, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify(jevRequest(input)) });
  if (!r.ok) throw new Error(`Jev ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()).answers as JevAnswers;
}

export type JevDecision =
  | { route: "allocate"; proposal: AgentProposal }
  | { route: "person"; reason: string }
  | { route: "grok"; reason: string };

// Code decides from Jev's judgment; amounts come from the charge, never from Jev.
export function decide(a: JevAnswers, input: Pass3Input, openAmount: Map<string, Pence>, t = JEV_T): JevDecision {
  const fits = a.any_fits.noul;
  const shape = a.shape.choice;
  const shapeP = a.shape.probabilities[shape] ?? 0;
  const charge = a.charge.choice;
  const chargeP = a.charge.probabilities[charge] ?? 0;
  if (fits < t.fitsNo && shapeP >= t.personSure && (shape === "unknown" || shape === "duplicate")) return { route: "person", reason: `Jev: payer fits no tenant (any_fits ${fits.toFixed(2)})` };
  if (shape === "duplicate" && shapeP >= t.personSure) return { route: "person", reason: `Jev: possible duplicate (${shapeP.toFixed(2)})` };
  if (shape === "one_charge" && shapeP >= t.shape && charge !== "none" && chargeP >= t.charge && fits >= t.fitsYes) {
    const c = input.candidates.find((x) => x.id === charge);
    const open = openAmount.get(charge);
    if (c && open !== undefined && open > 0) {
      const amt = toPence(input.bank_line.amount);
      const alloc = Math.min(amt, open);
      const b = input.bank_line;
      return {
        route: "allocate",
        proposal: {
          allocations: [{ charge_id: charge, amount: Number(fmt(alloc)) }],
          unallocated_amount: Number(fmt(amt - alloc)),
          confidence: Math.min(chargeP, shapeP),
          reasoning: `Jev: pays ${c.invoice_ref} (${chargeP.toFixed(2)}), one charge (${shapeP.toFixed(2)}), payer fits (${fits.toFixed(2)}); code allocated ${fmt(alloc)}${amt > alloc ? `, ${fmt(amt - alloc)} left as credit` : amt < open ? `, ${fmt(open - alloc)} of the charge stays open` : ""}.`,
          evidence: [
            { type: "bank_line", ref: b.id, quote: `${b.payer_name} ${b.reference} amount ${b.amount}` },
            { type: "charge", ref: c.id, quote: `${c.tenant_name} ${c.type} ${c.period} amount_open ${fmt(open)}` },
          ],
        },
      };
    }
  }
  return { route: "grok", reason: `Jev unsure: shape ${shape} ${shapeP.toFixed(2)}, charge ${charge} ${chargeP.toFixed(2)}, any_fits ${fits.toFixed(2)}` };
}
