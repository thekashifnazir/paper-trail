// The UI's view of the engine (shapes in lib/types.ts, owned by the frontend). Thin: reads the service's state,
// computes nothing the service doesn't already know, never reads the answer key except for the run score.
import type { AllocationView, AuditRow, Evidence as UiEvidence, LineView, ReviewReason, RunSummary } from "@/lib/types";
import { fmt, toPence } from "./money";
import { score } from "./score";
import { openAmounts, PAYER_NOT_TENANT, type Store } from "./service";
import type { Allocation } from "./types";

const UI_EVIDENCE: Record<string, UiEvidence["type"]> = {
  bank_line: "bank_line", charge: "charge", lease: "lease", alias: "alias", note: "tenant_note", tenant: "company_lookup",
  // Grok Bot's review of a queued line (lib/mcp/handler.ts review_line): the evidence card shows it as "grok bot".
  grok_bot: "grok_bot" as UiEvidence["type"],
  tenant_note: "tenant_note", company_lookup: "company_lookup",
};
const evidenceView = (ev: { type: string; ref: string; quote: string }[] = []): UiEvidence[] =>
  ev.map((e) => ({ type: UI_EVIDENCE[e.type] ?? "rule", ref: e.ref, quote: e.quote }));

const pounds = (p: number) => Number(fmt(p));
const DUPLICATE = /duplicate|already (allocated|matched)/i;
const HUMAN_DECISIONS = new Set(["approved", "hold_confirmed", "manual_match"]);
const monthOf = (b: { statement_month?: string; date: string }) => b.statement_month ?? b.date.slice(0, 7);

export function lineViews(s: Store, month?: string): LineView[] {
  const open = openAmounts(s);
  const charge = new Map(s.charges.map((c) => [c.id, c]));
  const byPerson = new Set(s.audit.filter((a) => a.actor === "human" && HUMAN_DECISIONS.has(a.action)).map((a) => a.bank_line_id));
  return s.bankLines.filter((b) => !month || monthOf(b) === month).map((b): LineView => {
    const mine = s.allocations.filter((a) => a.bank_line_id === b.id);
    const live = mine.filter((a) => a.status !== "rejected");
    const hold = s.holds.find((h) => h.bank_line_id === b.id);
    const amount = toPence(b.amount);
    const placed = live.reduce((x, a) => x + a.amount, 0);
    const status: LineView["status"] =
      live.some((a) => a.status === "proposed") ? "proposed"
      : live.length ? "approved"
      : hold ? (hold.decided ? "approved" : "proposed")
      : mine.length ? "rejected" : null;
    const allocations: AllocationView[] = live.map((a: Allocation) => {
      const c = charge.get(a.charge_id)!;
      const after = open.get(a.charge_id) ?? 0;
      return {
        charge_id: c.id, tenant_id: c.tenant_id, tenant_name: c.tenant_name, unit: c.unit, charge_type: c.type as AllocationView["charge_type"], period: c.period,
        amount_due: pounds(toPence(c.amount_due)), outstanding_before: pounds(after + a.amount), allocated: pounds(a.amount), outstanding_after: pounds(after),
      };
    });
    const reason = s.reviewReason.get(b.id) ?? hold?.reasoning ?? "";
    let review_reason: ReviewReason = null;
    if (status === "proposed") {
      if (hold) review_reason = /duplicate/i.test(reason) ? "Possible duplicate payment" : "Unidentified receipt";
      else if (reason === PAYER_NOT_TENANT) review_reason = "New payer relationship";
      else if (amount > placed) review_reason = "Overpayment";
      else if (allocations.some((a) => a.outstanding_after > 0)) review_reason = "Short payment";
      else review_reason = "Low confidence";
    }
    // who decided: a person's approval reads "human"; a line held as a possible duplicate reads "rule"
    const duplicate = !live.length && Boolean(hold) && (DUPLICATE.test(hold!.reasoning) || DUPLICATE.test(s.reviewReason.get(b.id) ?? ""));
    const method: LineView["method"] =
      duplicate ? "rule"
      : status === "approved" && byPerson.has(b.id) ? "human"
      : live[0]?.method ?? (hold ? "agent" : null);
    const evidence = evidenceView(hold?.evidence ?? live[0]?.evidence);
    // a parent company or group payer: show each allocated tenant's lease next to the lookup row that links them
    if (evidence.some((e) => e.type === "company_lookup")) {
      for (const a of live) {
        const c = charge.get(a.charge_id);
        if (c?.lease_citation && !evidence.some((e) => e.type === "lease" && e.quote === c.lease_citation)) {
          evidence.push({ type: "lease", ref: `${c.tenant_name} (${c.tenant_id})`, quote: c.lease_citation });
        }
      }
    }
    return {
      id: b.id, statement_month: monthOf(b), date: b.date, amount: pounds(amount), payer_name: b.payer_name, reference: b.reference,
      method, status,
      confidence: live[0]?.confidence ?? (hold ? hold.confidence : null), review_reason,
      reasoning: hold?.reasoning ?? s.reasoning.get(b.id) ?? (live[0] && live[0].method !== "agent" ? live[0].evidence.map((e) => e.quote).join(" · ") : null),
      unallocated_amount: pounds(amount - placed), allocations, evidence,
    };
  });
}

export function runSummary(s: Store, month?: string): RunSummary {
  const lines = lineViews(s, month);
  const methods = ["exact", "memory", "agent", "human"] as const;
  const auto = lines.filter((l) => l.status === "approved" && l.allocations.length);
  const ids = new Set(lines.map((l) => l.id));
  const truth = s.truth.filter((t) => ids.has(t.bank_line_id));
  const out: RunSummary = {
    month: month ?? "all",
    total_lines: lines.length,
    total_value: pounds(lines.reduce((x, l) => x + toPence(l.amount), 0)),
    by_method: methods.map((m) => {
      const ls = lines.filter((l) => l.method === m && l.status === "approved" && l.allocations.length);
      return { method: m, lines: ls.length, value: pounds(ls.reduce((x, l) => x + toPence(l.amount), 0)) };
    }),
    in_queue: lines.filter((l) => l.status === "proposed").length,
    unallocated_value: pounds(lines.reduce((x, l) => x + toPence(l.unallocated_amount), 0)),
  };
  if (truth.length && auto.length) {
    const amounts = new Map(lines.map((l) => [l.id, toPence(l.amount)]));
    const sc = score(truth.filter((t) => auto.some((l) => l.id === t.bank_line_id)),
      auto.flatMap((l) => l.allocations.map((a) => ({ bank_line_id: l.id, charge_id: a.charge_id, amount: toPence(a.allocated), method: l.method ?? "" }))), amounts);
    out.score = { auto_rate: auto.length / lines.length, precision: sc.precision, wrong_allocations: sc.wrong };
  }
  return out;
}

export const auditRows = (s: Store): AuditRow[] =>
  [...s.audit].reverse().map((a) => ({ ts: a.at, actor: a.actor, action: a.action, object_id: a.bank_line_id ?? "", detail: a.detail }));
