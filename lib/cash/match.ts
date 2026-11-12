// Pass 1 (exact) and pass 2 (memory). Port of cashgen/match.py: same order, same rules, pence instead of floats.
import { checkSum } from "./checkSum";
import { fmt, toPence } from "./money";
import type { Allocation, BankLine, Charge, PayerAlias, Pence } from "./types";

export interface MatchResult {
  allocations: Allocation[];
  leftover: BankLine[]; // for pass 3
  openAmount: Map<string, Pence>; // charge id -> open pence after passes 1 and 2
}

// openAmount: pass the current open amounts to run on top of earlier allocations; defaults to amount_due.
export function allocate(
  charges: Charge[],
  bankLines: BankLine[],
  aliases: Pick<PayerAlias, "payer_name" | "tenant_id">[] = [],
  openAmount: Map<string, Pence> = new Map(charges.map((c) => [c.id, toPence(c.amount_due)])),
): MatchResult {
  const open = new Map(openAmount);
  const byRef = new Map(charges.map((c) => [c.invoice_ref, c]));
  const alias = new Map(aliases.map((a) => [a.payer_name.toUpperCase(), a.tenant_id]));
  const allocations: Allocation[] = [];
  const leftover: BankLine[] = [];

  for (const b of [...bankLines].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0))) {
    const amt = toPence(b.amount);
    let placed: { method: "exact" | "memory"; allocs: [string, Pence][]; evidence: Allocation["evidence"] } | null = null;

    // pass 1: an invoice reference in the bank reference, and the amount equals that charge's open amount
    for (const word of b.reference.split(/\s+/).filter(Boolean)) {
      const c = byRef.get(word);
      if (c && open.get(c.id) === amt) {
        placed = {
          method: "exact",
          allocs: [[c.id, amt]],
          evidence: [
            { type: "bank_line", ref: b.id, quote: `reference ${word} and amount ${fmt(amt)}` },
            { type: "charge", ref: c.id, quote: `${c.invoice_ref} ${c.type} ${c.period} open ${fmt(amt)}` },
          ],
        };
        break;
      }
    }

    // pass 2: approved payer alias -> that tenant's open charges, one charge or all of them, oldest first
    const tid = alias.get(b.payer_name.toUpperCase());
    if (!placed && tid !== undefined) {
      const mine = charges
        .filter((c) => c.tenant_id === tid && (open.get(c.id) ?? 0) > 0)
        .sort((x, y) => (x.due_date < y.due_date ? -1 : x.due_date > y.due_date ? 1 : 0));
      const one = mine.find((c) => open.get(c.id) === amt);
      const aliasEv = { type: "alias" as const, ref: b.payer_name, quote: `alias ${b.payer_name} -> ${tid}` };
      if (one) {
        placed = { method: "memory", allocs: [[one.id, amt]], evidence: [aliasEv] };
      } else if (mine.length && mine.reduce((s, c) => s + open.get(c.id)!, 0) === amt) {
        placed = {
          method: "memory",
          allocs: mine.map((c) => [c.id, open.get(c.id)!]),
          evidence: [{ ...aliasEv, quote: `${aliasEv.quote}, all open charges` }],
        };
      }
    }

    if (!placed) {
      leftover.push(b);
      continue;
    }
    if (!checkSum(amt, placed.allocs.map(([, a]) => ({ amount: a })))) throw new Error(`sum check failed on ${b.id}`);
    for (const [cid, a] of placed.allocs) {
      open.set(cid, open.get(cid)! - a);
      allocations.push({
        id: `${b.id}:${cid}`,
        bank_line_id: b.id,
        charge_id: cid,
        amount: a,
        method: placed.method,
        confidence: 1,
        evidence: placed.evidence,
        status: "approved",
      });
    }
  }
  return { allocations, leftover, openAmount: open };
}
