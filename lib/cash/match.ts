// Pass 1 (code) and pass 2 (memory), in pence. Pass 1, per the team README:
//   1a invoice ref in the bank reference and amount = open amount (port of cashgen/match.py),
//   1b the same with the reference normalised (INV2609033S, inv 2609 033 s),
//   1c duplicate guard: same payer, amount and reference as a line placed up to 7 days before -> leave open
//      (team data: duplicates arrive 0-5 days after, legitimate monthly repeats 20+ days),
//   1d payer name -> exactly one tenant, and a subset of its open charges sums to the amount; when several
//      subsets fit (the same charges every month), the oldest charges win; a tie on that stays open.
// Pass 2: payer approved before (alias) -> one charge, or all that tenant's open charges (match.py).
import { checkSum } from "./checkSum";
import { fmt, toPence } from "./money";
import type { Allocation, BankLine, Charge, PayerAlias, Pence } from "./types";

const normRef = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

// "Anchor Lettings Ltd" -> ["ANCHOR LETTINGS LTD", "ANCHOR LETTINGS LIMITED"]; bank payer names arrive cut at 18 chars.
const normName = (s: string) => s.toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
function nameVariants(name: string): string[] {
  const n = normName(name);
  return [...new Set([n, n.replace(/\bLTD$/, "LIMITED"), n.replace(/\bLIMITED$/, "LTD")])];
}
export function tenantForPayer(payer: string, charges: Charge[]): string | undefined {
  const p = normName(payer);
  if (!p) return undefined;
  const hits = new Set<string>();
  for (const c of charges) {
    if (nameVariants(c.tenant_name).some((v) => v === p || (p.length >= 12 && v.startsWith(p)))) hits.add(c.tenant_id);
  }
  return hits.size === 1 ? [...hits][0] : undefined;
}

// A payer may be allocated to a tenant's charges without a person only when the payer is that tenant (bank name
// allowing for the 18-character cut) or a person approved that payer for that tenant before (payer memory).
export function payerKnown(payer: string, tenantId: string, charges: Charge[], aliases: Pick<PayerAlias, "payer_name" | "tenant_id">[]): boolean {
  if (tenantForPayer(payer, charges) === tenantId) return true;
  return aliases.some((a) => a.payer_name.toUpperCase() === payer.toUpperCase() && a.tenant_id === tenantId);
}

export const DUPLICATE_WINDOW_DAYS = 7;
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

// The subset of `cs` whose open amounts sum to `amt` with the oldest latest due date; undefined when none fits
// or two fit equally.
function oldestSubset(cs: Charge[], open: Map<string, Pence>, amt: Pence): Charge[] | undefined {
  if (cs.length > 14) return undefined;
  let best: Charge[] | undefined, bestDue = "", tie = false;
  for (let mask = 1; mask < 1 << cs.length; mask++) {
    let sum = 0;
    for (let i = 0; i < cs.length; i++) if (mask & (1 << i)) sum += open.get(cs[i].id)!;
    if (sum !== amt) continue;
    const sub = cs.filter((_, i) => mask & (1 << i));
    const due = sub.reduce((m, c) => (c.due_date > m ? c.due_date : m), "");
    if (!best || due < bestDue) { best = sub; bestDue = due; tie = false; }
    else if (due === bestDue) tie = true;
  }
  return tie ? undefined : best;
}

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
  const byNormRef = new Map(charges.map((c) => [normRef(c.invoice_ref), c]));
  const placedKeys = new Map<string, BankLine>(); // payer|amount|reference -> last placed line
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

    // 1b: the normalised invoice ref inside the normalised reference, amount = open amount, one charge only
    if (!placed) {
      const ref = normRef(b.reference);
      const hits = ref ? [...byNormRef.entries()].filter(([k, c]) => k && ref.includes(k) && open.get(c.id) === amt) : [];
      if (hits.length === 1) {
        const c = hits[0][1];
        placed = {
          method: "exact",
          allocs: [[c.id, amt]],
          evidence: [
            { type: "bank_line", ref: b.id, quote: `reference "${b.reference}" contains ${c.invoice_ref}, amount ${fmt(amt)}` },
            { type: "charge", ref: c.id, quote: `${c.invoice_ref} ${c.type} ${c.period} open ${fmt(amt)}` },
          ],
        };
      }
    }

    // 1c: duplicate guard
    const key = `${b.payer_name.toUpperCase()}|${amt}|${b.reference.trim().toUpperCase()}`;
    const prev = placed ? undefined : placedKeys.get(key);
    const dupOf = prev && days(prev.date, b.date) <= DUPLICATE_WINDOW_DAYS ? prev.id : undefined;

    // 1d: payer name -> one tenant, one subset of its open charges sums to the amount
    if (!placed && !dupOf) {
      const t = tenantForPayer(b.payer_name, charges);
      const mine = t ? charges.filter((c) => c.tenant_id === t && (open.get(c.id) ?? 0) > 0).sort((x, y) => (x.due_date < y.due_date ? -1 : x.due_date > y.due_date ? 1 : 0)) : [];
      const sub = mine.length ? oldestSubset(mine, open, amt) : undefined;
      if (sub) {
        placed = {
          method: "exact",
          allocs: sub.map((c) => [c.id, open.get(c.id)!]),
          evidence: [
            { type: "bank_line", ref: b.id, quote: `payer ${b.payer_name} is tenant ${sub[0].tenant_name}` },
            ...sub.map((c) => ({ type: "charge" as const, ref: c.id, quote: `${c.invoice_ref} ${c.type} ${c.period} open ${fmt(open.get(c.id)!)}` })),
            { type: "bank_line", ref: b.id, quote: `amount ${fmt(amt)} = sum of ${sub.length} open charge(s), oldest charges that fit` },
          ],
        };
      }
    }

    // pass 2: approved payer alias -> that tenant's open charges, one charge or all of them, oldest first
    const tid = alias.get(b.payer_name.toUpperCase());
    if (!placed && !dupOf && tid !== undefined) {
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
    placedKeys.set(key, b);
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
