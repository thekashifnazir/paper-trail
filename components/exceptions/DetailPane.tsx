"use client";

import { AlertTriangle, Check, Search, X } from "lucide-react";
import {
  EvidenceCard,
  isDecisiveEvidence,
  Keycap,
  MethodBadge,
  Money,
  SegmentMeter,
  moneyText,
} from "@/components/shared";
import { gbp, shortDate } from "@/lib/format";
import type { Evidence, LineView } from "@/lib/types";

const EVIDENCE_RANK: Record<string, number> = {
  company_lookup: 0,
  alias: 0,
  tenant_note: 1,
  charge: 2,
  lease: 3,
  bank_line: 4,
};

function evidenceRank(type: string) {
  return EVIDENCE_RANK[type] ?? 5;
}

function sortEvidence(items: Evidence[]): Evidence[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const rank = evidenceRank(a.item.type) - evidenceRank(b.item.type);
      return rank !== 0 ? rank : a.index - b.index;
    })
    .map(({ item }) => item);
}

function keepsUnallocated(line: LineView) {
  return (
    line.review_reason === "Unidentified receipt" ||
    line.review_reason === "Possible duplicate payment"
  );
}

function allocatedTotal(line: LineView) {
  return line.allocations.reduce((sum, row) => sum + row.allocated, 0);
}

function receiptBalances(line: LineView) {
  return Math.abs(allocatedTotal(line) + line.unallocated_amount - line.amount) <= 0.01;
}

function BalanceRow({ line }: { line: LineView }) {
  const balanced = receiptBalances(line);
  const allocated = allocatedTotal(line);
  const unallocated =
    line.unallocated_amount !== 0 ? ` + ${gbp(line.unallocated_amount)} unallocated` : "";
  const Icon = balanced ? Check : AlertTriangle;
  return (
    <div
      className={`mt-2 flex h-8 items-center gap-2 rounded-[6px] px-2.5 text-[12px] ${
        balanced ? "bg-memory-tint text-memory" : "bg-risk-tint text-risk"
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
      <span className="font-medium">{balanced ? "Balances:" : "Does not balance:"}</span>
      <span className="money">
        {gbp(allocated)} allocated{unallocated} of {gbp(line.amount)} received
      </span>
    </div>
  );
}

const TH = "label h-8 whitespace-nowrap border-b border-line bg-canvas px-3 text-left align-middle font-medium";
const TD = "h-10 whitespace-nowrap border-b border-line px-3 align-middle overflow-hidden";

function AllocationTable({ line }: { line: LineView }) {
  return (
    <div>
      <div className="label mb-2">Proposed allocation</div>
      <div className="overflow-hidden rounded-[8px] border border-line">
        <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
          <colgroup>
            <col style={{ width: "34%" }} />
            <col style={{ width: "27%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
          </colgroup>
          <thead>
            <tr>
              <th className={TH}>Tenant</th>
              <th className={TH}>Charge</th>
              <th className={`${TH} text-right`} title="Outstanding before">Before</th>
              <th className={`${TH} text-right`}>Allocated</th>
              <th className={`${TH} text-right`} title="Outstanding after">After</th>
            </tr>
          </thead>
          <tbody className="[&>tr:last-child>td]:border-b-0">
            {line.allocations.map((row) => (
              <tr key={row.charge_id}>
                <td className={`${TD} truncate`} title={`${row.tenant_name} · ${row.unit}`}>
                  <span className="font-medium text-ink">{row.tenant_name}</span>
                  <span className="ml-2 text-[12px] text-muted">{row.unit}</span>
                </td>
                <td className={TD}>
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="mono shrink-0 text-[12px] text-ink">{row.charge_id}</span>
                    <span className="truncate text-[12px] text-muted">
                      {row.charge_type.replaceAll("_", " ")} · {row.period}
                    </span>
                  </span>
                </td>
                <td className={`${TD} text-right`}>
                  <Money value={row.outstanding_before} tone="muted" />
                </td>
                <td className={`${TD} text-right`}>
                  <Money value={row.allocated} className="font-medium" />
                </td>
                <td className={`${TD} text-right`}>
                  <Money value={row.outstanding_after} tone="muted" />
                </td>
              </tr>
            ))}
            {line.unallocated_amount !== 0 ? (
              <tr className="bg-queue-tint/50">
                <td className={`${TD} font-medium text-queue`} colSpan={3}>
                  Unallocated
                </td>
                <td className={`${TD} text-right`}>
                  <Money value={line.unallocated_amount} className="font-medium text-queue" />
                </td>
                <td className={TD} />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <BalanceRow line={line} />
    </div>
  );
}

export function DetailPane({
  line,
  busy,
  onApprove,
  onReject,
  onFindMatch,
}: {
  line: LineView;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onFindMatch: () => void;
}) {
  const unallocated = keepsUnallocated(line);
  const showLedger = !unallocated && line.allocations.length > 0;
  const evidence = sortEvidence(line.evidence);

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[8px] border border-line bg-surface">
      <header className="flex shrink-0 items-center justify-between gap-6 border-b border-line px-6 py-4">
        <div className="min-w-0">
          <h2 className="mono truncate text-[17px] font-medium leading-6 text-ink">
            {line.payer_name}
          </h2>
          <div className="mono mt-0.5 flex gap-2 truncate text-[12px] text-muted">
            <span className="truncate">{line.reference}</span>
            <span aria-hidden>·</span>
            <span className="whitespace-nowrap">{shortDate(line.date)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          {line.review_reason ? (
            <span className="inline-flex h-6 items-center rounded-full bg-queue-tint px-2.5 text-[12px] font-medium text-queue">
              {line.review_reason}
            </span>
          ) : null}
          <Money value={line.amount} size="kpi" />
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-auto overscroll-contain px-6 py-5">
        {unallocated ? (
          <div className="rounded-[8px] border border-line bg-canvas px-4 py-3">
            <div className="label">Nothing allocated</div>
            <p className="mt-1.5 text-[16px] leading-relaxed text-ink">
              Nothing was allocated.
              {line.reasoning ? ` ${moneyText(line.reasoning)}` : ""}
            </p>
          </div>
        ) : null}

        {showLedger ? <AllocationTable line={line} /> : null}

        <section>
          <div className="label mb-2">Why</div>
          <div className="flex flex-wrap items-center gap-3">
            <MethodBadge method={line.method} />
            <SegmentMeter value={line.confidence} tone={line.method === "agent" ? "agent" : "ink"} />
          </div>
          {!unallocated && line.reasoning ? (
            <p className="mt-3 max-w-[72ch] text-[16px] leading-[1.55] text-ink">
              {moneyText(line.reasoning)}
            </p>
          ) : null}
        </section>

        {evidence.length > 0 ? (
          <section>
            <div className="mb-2 flex items-baseline gap-2">
              <span className="label">Evidence</span>
              <span className="text-[12px] text-muted">Every claim is quoted from a source</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {evidence.map((item, index) => (
                <EvidenceCard
                  key={`${item.type}-${item.ref}-${index}`}
                  item={item}
                  className={isDecisiveEvidence(item.type) ? "col-span-2" : ""}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <div className="flex h-14 shrink-0 items-center gap-2 border-t border-line bg-surface px-6">
        <button
          type="button"
          onClick={onApprove}
          disabled={busy}
          className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-approve px-3.5 text-[13px] font-medium text-surface hover:opacity-90 disabled:opacity-60"
        >
          <Check className="h-4 w-4" strokeWidth={2.25} aria-hidden />
          {unallocated ? "Keep unallocated" : "Approve"}
          <kbd className="keycap !h-4 !min-w-4 !border-surface/30 !bg-transparent !text-surface">
            A
          </kbd>
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={busy}
          className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-line bg-surface px-3.5 text-[13px] font-medium text-ink hover:bg-canvas disabled:opacity-60"
        >
          <X className="h-4 w-4 text-muted" strokeWidth={2.25} aria-hidden />
          Reject
          <Keycap>R</Keycap>
        </button>
        <button
          type="button"
          onClick={onFindMatch}
          disabled={busy}
          className={`inline-flex h-9 items-center gap-2 rounded-[8px] border px-3.5 text-[13px] font-medium hover:bg-canvas disabled:opacity-60 ${
            unallocated ? "border-ink bg-surface text-ink" : "border-line bg-surface text-ink"
          }`}
          title="Search open charges and allocate this receipt by hand"
        >
          <Search className="h-4 w-4 text-muted" strokeWidth={2.25} aria-hidden />
          Find match
          <Keycap>F</Keycap>
        </button>
        <span className="ml-auto flex items-center gap-1.5 text-[12px] text-muted">
          <Keycap>J</Keycap>
          <Keycap>K</Keycap>
          <span className="ml-1">next / previous</span>
        </span>
      </div>
    </section>
  );
}
