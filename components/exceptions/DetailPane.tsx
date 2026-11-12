"use client";

import { Check } from "lucide-react";
import {
  ConfidenceMeter,
  EvidenceCard,
  MethodBadge,
  Money,
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

function receiptBalances(line: LineView) {
  const allocated = line.allocations.reduce((sum, row) => sum + row.allocated, 0);
  return Math.abs(allocated + line.unallocated_amount - line.amount) <= 0.01;
}

function receivedEquation(line: LineView) {
  const parts = line.allocations.map((row) => gbp(row.allocated));
  if (line.unallocated_amount !== 0) parts.push(gbp(line.unallocated_amount));
  return `${parts.join(" + ")} = ${gbp(line.amount)} received`;
}

export function DetailPane({
  line,
  busy,
  onApprove,
  onReject,
}: {
  line: LineView;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const unallocated = keepsUnallocated(line);
  const showLedger = !unallocated && line.allocations.length > 0;
  const evidence = sortEvidence(line.evidence);
  const balanced = receiptBalances(line);

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface">
      <header className="shrink-0 border-b border-line px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[28px] font-semibold leading-tight tracking-tight text-ink">
              {line.payer_name}
            </h2>
            <div className="mt-1 font-mono text-[14px] text-muted">{line.reference}</div>
            <div className="mt-1 text-[13px] text-muted">{shortDate(line.date)}</div>
          </div>
          {line.review_reason ? (
            <span className="shrink-0 rounded-full bg-queue-tint px-3 py-1 text-[12px] font-semibold text-queue">
              {line.review_reason}
            </span>
          ) : null}
        </div>
        <p className="money tabular mt-4 text-[44px] font-semibold leading-none text-ink">
          {gbp(line.amount)}
        </p>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-auto overscroll-contain px-5 py-5">
        {unallocated ? (
          <div className="rounded-md border border-line bg-canvas px-4 py-4">
            <p className="font-semibold text-ink">Nothing allocated</p>
            <p className="mt-2 text-[18px] leading-relaxed">
              Nothing was allocated.
              {line.reasoning ? ` ${line.reasoning}` : ""}
            </p>
          </div>
        ) : null}

        {showLedger ? (
          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">
              Proposed allocation
            </div>
            <div className="overflow-auto rounded-md border border-line">
              <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
                <thead className="bg-canvas text-[11px] uppercase tracking-[0.05em] text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Tenant</th>
                    <th className="px-3 py-2 font-medium">Charge</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Outstanding before
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Allocated</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Outstanding after
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {line.allocations.map((row) => (
                    <tr key={row.charge_id} className="border-t border-line">
                      <td className="px-3 py-2">
                        <div className="font-medium">{row.tenant_name}</div>
                        <div className="text-muted">{row.unit}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-mono">{row.charge_id}</div>
                        <div className="text-muted">
                          {row.charge_type.replaceAll("_", " ")} · {row.period}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Money value={row.outstanding_before} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Money value={row.allocated} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Money value={row.outstanding_after} />
                      </td>
                    </tr>
                  ))}
                  {line.unallocated_amount !== 0 ? (
                    <tr className="border-t border-line bg-queue-tint/40">
                      <td className="px-3 py-2 font-medium" colSpan={3}>
                        Unallocated
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Money value={line.unallocated_amount} />
                      </td>
                      <td />
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <p className="mt-2 flex items-center gap-2 text-[13px] text-muted">
              {balanced ? (
                <Check className="h-4 w-4 shrink-0 text-ink" aria-hidden />
              ) : null}
              <span className="money text-ink">{receivedEquation(line)}</span>
            </p>
          </div>
        ) : null}

        <section>
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">
            Why
          </h3>
          <div className="flex flex-wrap items-center gap-3">
            <MethodBadge method={line.method} />
            <div className="w-[140px]">
              <ConfidenceMeter value={line.confidence} />
            </div>
          </div>
          {!unallocated && line.reasoning ? (
            <p className="mt-3 text-[18px] leading-relaxed">{line.reasoning}</p>
          ) : null}
        </section>

        <section>
          <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">
            Evidence · every claim is quoted from a source
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {evidence.map((item, index) => (
              <EvidenceCard key={`${item.type}-${item.ref}-${index}`} item={item} />
            ))}
          </div>
        </section>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line bg-surface px-5 py-4">
        <button
          type="button"
          onClick={onApprove}
          disabled={busy}
          className="rounded-md bg-ink px-4 py-2.5 text-[14px] font-semibold text-surface hover:opacity-90 disabled:opacity-60"
        >
          {unallocated ? "Keep unallocated" : "Approve"}
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={busy}
          className="rounded-md border border-line bg-transparent px-4 py-2.5 text-[14px] font-medium text-ink hover:bg-line/40 disabled:opacity-60"
        >
          Reject
        </button>
        <span className="text-[12px] text-muted">
          A approve · R reject · J/K next/prev
        </span>
      </div>
    </section>
  );
}
