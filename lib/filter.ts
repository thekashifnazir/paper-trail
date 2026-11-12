import type { LineView } from "@/lib/types";

export type AmountQuery = { op: "=" | ">" | "<"; value: number };

/** "4850", "£4,850.00", ">5000", "<100" → amount query; anything else → null. */
export function parseAmountQuery(raw: string): AmountQuery | null {
  const m = raw.trim().replace(/[£,\s]/g, "").match(/^([<>]=?|=)?(\d+(?:\.\d{1,2})?)$/);
  if (!m) return null;
  const op = m[1]?.startsWith(">") ? ">" : m[1]?.startsWith("<") ? "<" : "=";
  return { op, value: Number(m[2]) };
}

export function amountMatches(amount: number, q: AmountQuery): boolean {
  if (q.op === ">") return amount > q.value;
  if (q.op === "<") return amount < q.value;
  return Math.abs(amount - q.value) < 0.005;
}

/** Free-text match over payer, reference, allocated tenants, units and charge ids, or an amount. */
export function lineMatchesQuery(line: LineView, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const amount = parseAmountQuery(needle);
  if (amount) {
    if (amountMatches(line.amount, amount)) return true;
    if (amount.op !== "=") return false;
  }
  const hay = [
    line.payer_name,
    line.reference,
    line.id,
    ...line.allocations.flatMap((a) => [a.tenant_name, a.unit, a.charge_id, a.tenant_id]),
  ];
  return hay.some((s) => s.toLowerCase().includes(needle));
}
