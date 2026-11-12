import type { AllocationView, LineView } from "@/lib/types";

export type Band = "high" | "medium" | "none";

export function confidenceBand(line: LineView): Band {
  if (line.allocations.length === 0) return "none";
  return (line.confidence ?? 0) >= 0.9 ? "high" : "medium";
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-11-03" -> "03 Nov 2026" */
export function longDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "2026-09" -> "Sep 2026"; anything unrecognised is returned as-is. */
export function periodLabel(period: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(period);
  if (!m) return period;
  const idx = Number(m[2]) - 1;
  if (idx < 0 || idx > 11) return period;
  return `${MONTHS[idx].slice(0, 3)} ${m[1]}`;
}

export function chargeLabel(row: AllocationView): string {
  const type = row.charge_type === "service_charge" ? "Service charge" : "Rent";
  return `${type} · ${periodLabel(row.period)}`;
}

/** Sum in pence to avoid float drift; returns pounds. */
export function sumPounds(values: number[]): number {
  return values.reduce((acc, v) => acc + Math.round(v * 100), 0) / 100;
}

export function toPence(n: number): number {
  return Math.round(n * 100);
}

function norm(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function haystacks(line: LineView): string[] {
  const out: string[] = [];
  for (const a of line.allocations) {
    out.push(norm(a.charge_id), norm(a.unit), norm(a.tenant_name), norm(a.period));
    const m = /^\d{4}-(\d{2})/.exec(a.period);
    if (m) {
      const name = MONTHS[Number(m[1]) - 1];
      // Full month name covers abbreviations too: SEPTEMBER contains SEP and SEPT.
      if (name) out.push(norm(name));
    }
  }
  for (const e of line.evidence) {
    if ((e.type as string) === "bank_line") continue;
    out.push(norm(e.quote));
  }
  return out.filter((s) => s.length > 0);
}

export type RefPart = { text: string; hit: boolean };

/** Split a bank reference into parts, flagging tokens that appear in the matched ledger data. */
export function highlightReference(line: LineView): RefPart[] {
  const hay = haystacks(line);
  return line.reference
    .split(/([^A-Za-z0-9]+)/)
    .filter((p) => p.length > 0)
    .map((text) => {
      const token = norm(text);
      const hit = token.length >= 2 && hay.some((h) => h.includes(token));
      return { text, hit };
    });
}

export const EVIDENCE_LABEL: Record<string, string> = {
  bank_line: "Bank line",
  charge: "Charge",
  company_lookup: "Company lookup",
  tenant_note: "Tenant note",
  lease: "Lease",
  alias: "Payer memory",
  rule: "Rule",
  grok_bot: "Grok Bot review",
};

export function evidenceLabel(type: string): string {
  return EVIDENCE_LABEL[type] ?? type;
}
