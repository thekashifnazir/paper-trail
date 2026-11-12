// The team's source of truth: Kash's synthetic set in data/sample (committed, made-up names).
// Sep + Oct are for tuning. data/sample/holdout (November) is scored once at the end: only `holdout: true` reads it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "./csv";
import type { TruthRow } from "./score";
import type { BankLine, Charge, Tenant } from "./types";

export const SAMPLE_DIR = process.env.CASH_SAMPLE_DIR ?? join(process.cwd(), "data", "sample");
export const TUNING_MONTHS = ["2026-09", "2026-10"];

export interface TenantNote { tenant_id: string; date: string; note: string }
export interface CompanyLookup { payer_name: string; group_members: string[]; source: string }

export function loadData(opts: { months?: string[]; holdout?: boolean; dir?: string } = {}) {
  const dir = opts.dir ?? SAMPLE_DIR;
  const months = opts.months ?? (opts.holdout ? ["2026-11"] : TUNING_MONTHS);
  const sub = (f: string) => join(opts.holdout ? join(dir, "holdout") : dir, f);
  const j = (f: string) => JSON.parse(readFileSync(f, "utf8"));

  const rawTenants: { id: string; name: string; unit: string; lease_id: string; lease_citation: string }[] = j(join(dir, "tenants.json"));
  const companyLookup: CompanyLookup[] = j(join(dir, "company_lookup.json"));
  const parentOf = new Map(companyLookup.flatMap((l) => l.group_members.map((m) => [m.toUpperCase(), l.payer_name])));
  const tenants: Tenant[] = rawTenants.map((t) => ({ tenant_id: t.id, tenant_name: t.name, unit: t.unit, parent_company: parentOf.get(t.name.toUpperCase()) ?? "" }));
  const byId = new Map(rawTenants.map((t) => [t.id, t]));

  const rawCharges: Record<string, string | number>[] = opts.holdout ? j(sub("charges_2026_11.json")) : j(join(dir, "charges.json"));
  const charges: Charge[] = rawCharges.map((c) => {
    const t = byId.get(String(c.tenant_id));
    return {
      id: String(c.id), tenant_id: String(c.tenant_id), tenant_name: t?.name ?? "", unit: t?.unit ?? "", type: String(c.type), period: String(c.period),
      amount_due: Number(c.amount_due).toFixed(2), due_date: String(c.due_date), invoice_ref: String(c.invoice_ref), lease_citation: t?.lease_citation ?? "",
    };
  });

  const bankLines: BankLine[] = [];
  const truth: TruthRow[] = [];
  for (const m of months) {
    for (const r of parseCsv(readFileSync(sub(`bank_${m.replace("-", "_")}.csv`), "utf8"))) {
      bankLines.push({ id: r.id, date: r.date, amount: r.amount, payer_name: r.payer_name, reference: r.reference });
      const want: { charge_id: string; amount: number }[] = JSON.parse(r.true_allocations || "[]");
      truth.push({
        bank_line_id: r.id, case: r.case_type,
        true_charge_ids: want.map((w) => w.charge_id).join(";"), true_amounts: want.map((w) => w.amount.toFixed(2)).join(";"),
        true_unallocated: r.true_unallocated || "0.00",
      });
    }
  }
  const notes: TenantNote[] = j(opts.holdout ? sub("tenant_notes_2026_11.json") : join(dir, "tenant_notes.json"));
  return { tenants, charges, bankLines, truth, notes, companyLookup };
}

// Local only: the Cortile-based CSVs session 1 built, for the match.py parity check (CASH_DATA_DIR).
export function loadCsvDir(dir: string) {
  const read = (f: string) => { try { return parseCsv(readFileSync(join(dir, f), "utf8")); } catch { return []; } };
  return {
    charges: read("charges.csv") as unknown as Charge[],
    bankLines: read("bank_lines.csv") as unknown as BankLine[],
    tenants: read("tenants.csv") as unknown as Tenant[],
    truth: read("truth.csv") as unknown as TruthRow[],
    aliases: read("aliases.csv") as unknown as { payer_name: string; tenant_id: string }[],
  };
}
