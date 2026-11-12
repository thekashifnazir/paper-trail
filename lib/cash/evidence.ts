// "No source, no figure": every evidence quote in a proposal is checked in code against the source its ref names.
// The model quotes field values with their labels ("payer_name BEACON GRP PLC, reference RENT SEPT, amount 4158.34"),
// so a quote passes when, after normalising case, whitespace and punctuation:
//   - every word in it, apart from field labels, occurs in that source's fields, and
//   - every money amount in it equals an amount in that source (a number with decimals, or any number right after
//     "amount", "amount_open", "amount_due" or "£"; the model writes JSON numbers such as 6525 or 2137.5).
// A paraphrase brings words the source does not have, so it fails. A ref that names nothing fails.
import { toPence } from "./money";
import type { CompanyLookup, TenantNote } from "./data";
import type { BankLine, Charge, Evidence, Pence, Tenant } from "./types";

export interface EvidenceSources {
  bankLines: BankLine[];
  charges: Charge[];
  tenants: (Tenant & { lease_citation?: string })[];
  notes: TenantNote[];
  lookup: CompanyLookup[];
  openAmount?: Map<string, Pence>;
}

export interface EvidenceCheck {
  checked: number;
  rejected: { ref: string; quote: string; why: string }[];
}

// Field names and joining words the model uses as labels around quoted values.
const LABELS = new Set(
  "payer name reference ref amount amounts open due date type period tenant tenants parent company lookup group members member include includes earlier identical line lines invoice charge charges note notes lease citation unit id ids of and the is a for on in with as same empty blank none no".split(" "),
);

const norm = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/£/g, " ");
const AMOUNT = /(?<![\d.,-])(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{1,2}(?![\d-])/g; // 4,158.34 · 2137.5
const LABELLED = /(?:amount(?: open| due)?|£)\s*:?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?![\d.-])/g; // amount_open 6525
function amountsIn(s: string): Pence[] {
  const n = norm(s);
  return [...new Set([...[...n.matchAll(AMOUNT)].map((m) => m[0]), ...[...n.matchAll(LABELLED)].map((m) => m[1])])].map((x) => toPence(x.replace(/,/g, "")));
}
const words = (s: string) => norm(s).replace(LABELLED, " ").replace(AMOUNT, " ").split(/[^a-z0-9-]+/).map((w) => w.replace(/^-+|-+$/g, "")).filter(Boolean);

interface Source { text: string; amounts: Set<Pence> }

function resolve(ref: string, src: EvidenceSources): Source | null {
  const r = ref.toUpperCase();
  const parts: string[] = [];
  const amounts = new Set<Pence>();
  const add = (text: string, amts: Pence[] = []) => { parts.push(text); amts.forEach((a) => amounts.add(a)); amountsIn(text).forEach((a) => amounts.add(a)); };

  for (const b of src.bankLines) if (r.includes(b.id.toUpperCase())) add(`${b.id} ${b.date} ${b.payer_name} ${b.reference}`, [toPence(b.amount)]);
  for (const c of src.charges) {
    if (r.includes(c.id.toUpperCase()) || r.includes(c.invoice_ref.toUpperCase())) {
      const open = src.openAmount?.get(c.id);
      add(`${c.id} ${c.invoice_ref} ${c.tenant_id} ${c.tenant_name} ${c.type} ${c.period} ${c.due_date} ${c.unit}`, [toPence(c.amount_due), ...(open !== undefined ? [open] : [])]);
    }
  }
  const tenantIds = new Set((r.match(/\bT\d{3}\b/g) ?? []).filter((id) => src.tenants.some((t) => t.tenant_id === id)));
  for (const l of src.lookup) {
    if (r.includes(l.payer_name.toUpperCase())) {
      add(`${l.payer_name} ${l.group_members.join(" ")}`);
      for (const t of src.tenants) if (l.group_members.some((m) => m.toUpperCase() === t.tenant_name.toUpperCase())) tenantIds.add(t.tenant_id);
    }
  }
  const date = r.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  for (const id of tenantIds) {
    const t = src.tenants.find((x) => x.tenant_id === id)!;
    const look = src.lookup.filter((l) => l.group_members.some((m) => m.toUpperCase() === t.tenant_name.toUpperCase()));
    add(`${t.tenant_id} ${t.tenant_name} ${t.unit ?? ""} ${t.parent_company} ${look.map((l) => `${l.payer_name} ${l.group_members.join(" ")}`).join(" ")} ${t.lease_citation ?? ""}`);
    for (const n of src.notes) if (n.tenant_id === id && (!date || n.date === date)) add(`${n.date} ${n.note}`);
  }
  return parts.length ? { text: parts.join(" "), amounts } : null;
}

export function checkEvidence(evidence: Evidence[], src: EvidenceSources): EvidenceCheck {
  const out: EvidenceCheck = { checked: 0, rejected: [] };
  for (const e of evidence ?? []) {
    out.checked += 1;
    const s = resolve(String(e.ref ?? ""), src);
    if (!s) { out.rejected.push({ ref: e.ref, quote: e.quote, why: "ref names no known line, charge, tenant, note or lookup row" }); continue; }
    const have = new Set(words(s.text));
    const missing = words(String(e.quote ?? "")).filter((w) => !LABELS.has(w) && !have.has(w));
    if (missing.length) { out.rejected.push({ ref: e.ref, quote: e.quote, why: `not in source: ${missing.slice(0, 5).join(", ")}` }); continue; }
    const badAmount = amountsIn(norm(String(e.quote ?? ""))).find((a) => !s.amounts.has(a));
    if (badAmount !== undefined) out.rejected.push({ ref: e.ref, quote: e.quote, why: `amount ${(badAmount / 100).toFixed(2)} not in source` });
  }
  return out;
}
