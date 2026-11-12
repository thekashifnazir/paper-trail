"use client";

import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import {
  ConfidenceMeter,
  EmptyState,
  EvidenceCard,
  MethodBadge,
  Money,
} from "@/components/shared";
import { gbp } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { LineView, ReviewReason } from "@/lib/types";

const ORDER: ReviewReason[] = [
  "New payer relationship",
  "Short payment",
  "Overpayment",
  "Possible duplicate payment",
  "Unidentified receipt",
  "Low confidence",
];

const EVIDENCE_ORDER = [
  "company_lookup",
  "alias",
  "tenant_note",
  "charge",
  "lease",
  "bank_line",
  "rule",
];

export function ExceptionsPage() {
  const { lines, approve, reject } = useStore();
  const queue = useMemo(
    () => lines.filter((l) => l.status === "proposed"),
    [lines],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && queue[0]) setSelectedId(queue[0].id);
    if (selectedId && !queue.some((l) => l.id === selectedId)) {
      setSelectedId(queue[0]?.id ?? null);
    }
  }, [queue, selectedId]);

  const selected = queue.find((l) => l.id === selectedId) ?? null;
  const total = queue.reduce((s, l) => s + l.amount, 0);

  const groups = ORDER.map((reason) => ({
    reason,
    items: queue.filter((l) => l.review_reason === reason),
  })).filter((g) => g.items.length > 0);

  async function onApprove(line: LineView) {
    const remembered = await approve(line.id);
    if (remembered) {
      toast.success(remembered, {
        description: "Next month this matches automatically.",
      });
    } else {
      toast.success("Approved");
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!selected) return;
      const idx = queue.findIndex((l) => l.id === selected.id);
      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        void onApprove(selected);
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        void reject(selected.id);
      }
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        if (queue[idx + 1]) setSelectedId(queue[idx + 1].id);
      }
      if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        if (queue[idx - 1]) setSelectedId(queue[idx - 1].id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (queue.length === 0) {
    const resolved = lines.filter((l) => l.status === "approved").length;
    return (
      <EmptyState
        title="Queue clear"
        body={`${resolved} of ${lines.length || 200} receipts resolved. Switch to Arrears to see what is still owed.`}
      />
    );
  }

  const noAlloc =
    selected?.review_reason === "Unidentified receipt" ||
    selected?.review_reason === "Possible duplicate payment";

  const evidence = [...(selected?.evidence ?? [])].sort(
    (a, b) => EVIDENCE_ORDER.indexOf(a.type) - EVIDENCE_ORDER.indexOf(b.type),
  );

  const sumAlloc = selected
    ? selected.allocations.reduce((s, a) => s + a.allocated, 0)
    : 0;
  const balances =
    selected &&
    Math.abs(sumAlloc + selected.unallocated_amount - selected.amount) < 0.01;

  return (
    <div className="grid gap-3 lg:grid-cols-[380px_1fr]">
      <section className="overflow-hidden rounded-[12px] border border-hairline bg-sheet">
        <div className="border-b border-hairline px-3 py-2.5">
          <div className="text-[20px] font-medium tracking-[-0.02em]">
            Exceptions
          </div>
          <div className="mt-0.5 text-[12px] text-muted">
            {queue.length} to review · {gbp(total)}
          </div>
        </div>
        <div className="max-h-[72vh] overflow-auto">
          {groups.map((g) => (
            <div key={String(g.reason)}>
              <div className="sticky top-0 z-10 bg-fill px-3 py-1.5 text-[12px] font-medium tracking-[0.04em] text-muted">
                {g.reason} · {g.items.length}
              </div>
              {g.items.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setSelectedId(l.id)}
                  className={`flex w-full items-start gap-2 border-b border-hairline px-3 py-2.5 text-left ${
                    selectedId === l.id
                      ? "border-l-2 border-l-ink bg-fill"
                      : "border-l-2 border-l-transparent hover:bg-fill/70"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium">
                      {l.payer_name}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted">
                      {l.reference}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <Money value={l.amount} />
                    <div className="mt-1">
                      <ConfidenceMeter value={l.confidence} />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>

      {selected ? (
        <section className="flex min-h-[72vh] flex-col overflow-hidden rounded-[12px] border border-hairline bg-sheet">
          <div className="border-b border-hairline px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[12px] font-medium tracking-[0.04em] text-muted">
                  Bank line · {selected.date}
                </div>
                <h2 className="mt-0.5 text-[22px] font-medium leading-tight tracking-[-0.02em]">
                  {selected.payer_name}
                </h2>
                <div className="mt-0.5 font-mono text-[12px] text-muted">
                  {selected.reference}
                </div>
              </div>
              <span className="rounded-full bg-queue-wash px-2.5 py-0.5 text-[12px] font-medium text-queue">
                {selected.review_reason}
              </span>
            </div>
            <div className="mt-2.5">
              <Money value={selected.amount} large />
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-auto px-4 py-3">
            {noAlloc ? (
              <div className="rounded-lg border border-queue/40 bg-queue-wash/40 px-3 py-3">
                <div className="text-[14px] font-medium">Nothing allocated</div>
                <p className="mt-0.5 text-[13px] text-muted">{selected.reasoning}</p>
              </div>
            ) : (
              <div>
                <div className="mb-1.5 text-[12px] font-medium tracking-[0.04em] text-muted">
                  Proposed allocation
                </div>
                <div className="overflow-auto rounded-lg border border-hairline">
                  <table className="w-full min-w-[640px] text-left text-[13px]">
                    <thead className="bg-fill text-[12px] font-medium tracking-[0.04em] text-muted">
                      <tr>
                        <th className="px-2.5 py-1.5">Tenant</th>
                        <th className="px-2.5 py-1.5">Charge</th>
                        <th className="px-2.5 py-1.5 text-right">Before</th>
                        <th className="px-2.5 py-1.5 text-right">Allocated</th>
                        <th className="px-2.5 py-1.5 text-right">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.allocations.map((a) => (
                        <tr key={a.charge_id} className="border-t border-hairline">
                          <td className="px-2.5 py-2">
                            <div className="font-medium">{a.tenant_name}</div>
                            <div className="text-[12px] text-muted">{a.unit}</div>
                          </td>
                          <td className="px-2.5 py-2 font-mono text-[12px]">
                            {a.charge_id}
                            <div className="font-sans text-muted">
                              {a.charge_type.replace("_", " ")} · {a.period}
                            </div>
                          </td>
                          <td className="px-2.5 py-2">
                            <Money value={a.outstanding_before} />
                          </td>
                          <td className="px-2.5 py-2">
                            <Money value={a.allocated} />
                          </td>
                          <td className="px-2.5 py-2">
                            <Money value={a.outstanding_after} />
                          </td>
                        </tr>
                      ))}
                      {selected.unallocated_amount > 0 ? (
                        <tr className="border-t border-hairline bg-queue-wash/30">
                          <td className="px-2.5 py-2 font-medium" colSpan={3}>
                            Unallocated
                          </td>
                          <td className="px-2.5 py-2">
                            <Money value={selected.unallocated_amount} />
                          </td>
                          <td />
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted">
                  {balances ? <Check className="h-3.5 w-3.5 text-ink" /> : null}
                  {selected.allocations.map((a) => gbp(a.allocated)).join(" + ")}
                  {selected.unallocated_amount > 0
                    ? ` + ${gbp(selected.unallocated_amount)} unallocated`
                    : ""}{" "}
                  = {gbp(selected.amount)} received
                </div>
              </div>
            )}

            <div>
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <MethodBadge method={selected.method} status={selected.status} />
                <ConfidenceMeter value={selected.confidence} />
              </div>
              {selected.reasoning ? (
                <p className="text-[15px] leading-snug">{selected.reasoning}</p>
              ) : null}
            </div>

            <div>
              <div className="mb-2 text-[12px] font-medium tracking-[0.04em] text-muted">
                Evidence · every claim is quoted from a source
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {evidence.map((e, i) => (
                  <EvidenceCard key={`${e.type}-${i}`} item={e} />
                ))}
              </div>
            </div>
          </div>

          <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-hairline bg-sheet px-4 py-2.5">
            {noAlloc ? (
              <button
                type="button"
                onClick={() => void onApprove(selected)}
                className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-paper"
              >
                Keep unallocated
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void onApprove(selected)}
                className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-paper"
              >
                Approve
              </button>
            )}
            <button
              type="button"
              onClick={() => void reject(selected.id)}
              className="rounded-lg border border-hairline px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-fill"
            >
              Reject
            </button>
            <span className="text-[11px] text-muted">
              Shortcuts · A approve · R reject · J/K next/prev
            </span>
          </div>
        </section>
      ) : null}
    </div>
  );
}
