// Loads the team's committed synthetic set (data/sample: tenants.json, charges.json, bank_YYYY_MM.csv,
// company_lookup.json) into the engine's contract, with the answer key as truth rows.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "./csv";
import type { TruthRow } from "./score";
import type { BankLine, Charge, Tenant } from "./types";

export const SAMPLE_DIR = join(process.cwd(), "data", "sample");

export function loadSample(months: string[], dir = SAMPLE_DIR, chargesFile = "charges.json") {
  const j = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));
  const rawTenants: { id: string; name: string; unit: string; lease_citation: string }[] = j("tenants.json");
  const lookup: { payer_name: string; group_members: string[] }[] = j("company_lookup.json");
  const parentOf = new Map(lookup.flatMap((l) => l.group_members.map((m) => [m.toUpperCase(), l.payer_name])));
  const tenants: Tenant[] = rawTenants.map((t) => ({ tenant_id: t.id, tenant_name: t.name, unit: t.unit, parent_company: parentOf.get(t.name.toUpperCase()) ?? "" }));
  const byId = new Map(rawTenants.map((t) => [t.id, t]));
  const charges: Charge[] = (j(chargesFile) as Record<string, string | number>[]).map((c) => {
    const t = byId.get(String(c.tenant_id));
    return {
      id: String(c.id), tenant_id: String(c.tenant_id), tenant_name: t?.name ?? "", unit: t?.unit ?? "", type: String(c.type),
      period: String(c.period), amount_due: Number(c.amount_due).toFixed(2), due_date: String(c.due_date), invoice_ref: String(c.invoice_ref), lease_citation: t?.lease_citation ?? "",
    };
  });
  const bankLines: BankLine[] = [];
  const truth: TruthRow[] = [];
  for (const m of months) {
    for (const r of parseCsv(readFileSync(join(dir, `bank_${m.replace("-", "_")}.csv`), "utf8"))) {
      bankLines.push({ id: r.id, date: r.date, amount: r.amount, payer_name: r.payer_name, reference: r.reference });
      const want: { charge_id: string; amount: number }[] = JSON.parse(r.true_allocations || "[]");
      truth.push({ bank_line_id: r.id, case: r.case_type, true_charge_ids: want.map((w) => w.charge_id).join(";"), true_amounts: want.map((w) => w.amount.toFixed(2)).join(";") });
    }
  }
  return { tenants, charges, bankLines, truth };
}
