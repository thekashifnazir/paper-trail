// The open charges worth sending to the agent for one leftover line. Same logic as the pass 3 input
// session 1 built (cashgen/make_jev_kit.py), plus approved aliases and "amount fits a sum of one tenant's charges".
import { tenantForPayer } from "./match";
import { toPence } from "./money";
import type { BankLine, Charge, OpenCharge, PayerAlias, Pence, Tenant } from "./types";

export const MAX_CANDIDATES = 15;

export interface CandidateSet {
  bank_line: BankLine;
  candidates: OpenCharge[];
  earlier_identical_lines: string[]; // same payer, amount and reference on or before this date (duplicate rule)
}

export function candidates(
  line: BankLine,
  charges: Charge[],
  openAmount: Map<string, Pence>,
  tenants: Tenant[],
  aliases: Pick<PayerAlias, "payer_name" | "tenant_id">[] = [],
  allLines: BankLine[] = [],
): CandidateSet {
  const payer = line.payer_name.toUpperCase();
  const amt = toPence(line.amount);
  const open: OpenCharge[] = charges
    .filter((c) => (openAmount.get(c.id) ?? 0) > 0)
    .map(({ amount_due: _, ...c }) => ({ ...c, amount_open: openAmount.get(c.id)! }));

  // tenants the payer can stand for: same name, approved alias, or parent company
  const tids = new Set<string>();
  const byName = tenantForPayer(line.payer_name, charges); // handles bank names cut at 18 chars, Ltd/Limited
  if (byName) tids.add(byName);
  for (const t of tenants) {
    if (t.tenant_name.toUpperCase() === payer) tids.add(t.tenant_id);
    if (t.parent_company && t.parent_company.toUpperCase() === payer) tids.add(t.tenant_id);
  }
  for (const a of aliases) if (a.payer_name.toUpperCase() === payer) tids.add(a.tenant_id);

  const out: OpenCharge[] = open.filter((c) => tids.has(c.tenant_id));
  const add = (c: OpenCharge) => {
    if (!out.includes(c)) out.push(c);
  };
  // amount fits one open charge
  open.filter((c) => c.amount_open === amt).forEach(add);
  // amount fits the sum of one tenant's open charges
  const byTenant = new Map<string, OpenCharge[]>();
  for (const c of open) byTenant.set(c.tenant_id, [...(byTenant.get(c.tenant_id) ?? []), c]);
  for (const cs of byTenant.values()) {
    if (cs.length > 1 && cs.reduce((s, c) => s + c.amount_open, 0) === amt) cs.forEach(add);
  }

  const earlier = allLines
    .filter((x) => x.id !== line.id && x.payer_name === line.payer_name && x.amount === line.amount && x.reference === line.reference && x.date <= line.date)
    .map((x) => x.id);

  return { bank_line: line, candidates: out.slice(0, MAX_CANDIDATES), earlier_identical_lines: earlier };
}
