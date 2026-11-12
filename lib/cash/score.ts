// Port of cashgen/score.py. A line counts as correct only when its set of (charge_id, amount) equals the truth
// exactly and, when bank amounts are given, the amount left unallocated equals true_unallocated.
// Duplicates and unidentifiable lines are correct only when left unallocated.
import { toPence } from "./money";
import type { Pence } from "./types";

export interface TruthRow {
  bank_line_id: string;
  case: string;
  true_charge_ids: string;
  true_amounts: string;
  true_unallocated?: string;
}

export interface ScoredAllocation {
  bank_line_id: string;
  charge_id: string; // "" when the line was left open
  amount: Pence;
  method: string;
}

export interface Score {
  n: number;
  allocated: number;
  right: number;
  wrong: number;
  left: number;
  matchRate: number;
  precision: number;
  perCase: Record<string, { right: number; n: number }>;
  byMethod: Record<string, number>;
}

export function score(truth: TruthRow[], allocations: ScoredAllocation[], bankAmount?: Map<string, Pence>): Score {
  const got = new Map<string, Set<string>>();
  const method = new Map<string, string>();
  for (const a of allocations) {
    method.set(a.bank_line_id, a.method);
    if (a.charge_id) {
      if (!got.has(a.bank_line_id)) got.set(a.bank_line_id, new Set());
      got.get(a.bank_line_id)!.add(`${a.charge_id}|${a.amount}`);
    }
  }
  let right = 0, wrong = 0, left = 0;
  const perCase: Score["perCase"] = {};
  for (const t of truth) {
    const ids = t.true_charge_ids ? t.true_charge_ids.split(";") : [];
    const amts = t.true_amounts ? t.true_amounts.split(";") : [];
    const want = new Set(ids.map((id, i) => `${id}|${toPence(amts[i])}`));
    perCase[t.case] ??= { right: 0, n: 0 };
    perCase[t.case].n += 1;
    const g = got.get(t.bank_line_id) ?? new Set<string>();
    let ok: boolean;
    if (g.size === 0) {
      left += 1;
      ok = want.size === 0; // leaving a line open is right only when the truth is "no allocation"
    } else {
      ok = g.size === want.size && [...g].every((x) => want.has(x));
      const amt = bankAmount?.get(t.bank_line_id);
      if (ok && amt !== undefined && t.true_unallocated !== undefined) {
        const placed = [...g].reduce((x, k) => x + Number(k.split("|")[1]), 0);
        ok = amt - placed === toPence(t.true_unallocated);
      }
      if (ok) right += 1;
      else wrong += 1;
    }
    if (ok) perCase[t.case].right += 1;
  }
  const byMethod: Record<string, number> = {};
  for (const m of method.values()) byMethod[m] = (byMethod[m] ?? 0) + 1;
  const n = truth.length;
  return { n, allocated: right + wrong, right, wrong, left, matchRate: (right + wrong) / n, precision: right / Math.max(1, right + wrong), perCase, byMethod };
}

export function formatScore(s: Score): string {
  const lines = [
    `allocated ${s.allocated}/${s.n} (${Math.round(s.matchRate * 100)}%) · precision ${(s.precision * 100).toFixed(1)}% · left open ${s.left}`,
    ...Object.entries(s.perCase).map(([c, v]) => `  ${c.padEnd(24)} ${v.right}/${v.n}`),
    `by method: ${JSON.stringify(s.byMethod)}`,
  ];
  return lines.join("\n");
}
