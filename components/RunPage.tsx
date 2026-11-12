"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AllocationBar,
  ConfidenceMeter,
  EmptyState,
  EvidenceCard,
  KpiCard,
  KpiStrip,
  MethodBadge,
  Money,
} from "@/components/shared";
import { gbp, shortDate } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { LineView, Method } from "@/lib/types";

export function RunPage() {
  const { month, lines, summary, progress, loading, error, run } = useStore();
  const [filter, setFilter] = useState<"all" | Method | "queue">("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<LineView | null>(null);
  const running = progress.stage !== "idle" && progress.stage !== "done";

  const memoryCount = useMemo(
    () => lines.filter((l) => l.method === "memory" && l.status === "approved").length,
    [lines],
  );

  const filtered = useMemo(() => {
    return lines.filter((l) => {
      if (filter === "queue" && l.status !== "proposed") return false;
      if (filter !== "all" && filter !== "queue" && l.method !== filter) return false;
      if (!q) return true;
      const needle = q.toLowerCase();
      return (
        l.payer_name.toLowerCase().includes(needle) ||
        l.reference.toLowerCase().includes(needle)
      );
    });
  }, [lines, filter, q]);

  const exact = summary?.by_method.find((m) => m.method === "exact")?.lines ?? 0;
  const memory = summary?.by_method.find((m) => m.method === "memory")?.lines ?? 0;
  const agent = summary?.by_method.find((m) => m.method === "agent")?.lines ?? 0;
  const queue = summary?.in_queue ?? 0;
  const auto =
    summary && summary.total_lines
      ? (exact + memory) / summary.total_lines
      : 0;

  return (
    <div className="space-y-3">
      <section className="rounded-[12px] border border-hairline bg-sheet px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[24px] font-medium tracking-[-0.02em]">
              Cash application
            </h1>
            <p className="mt-0.5 max-w-2xl text-[13px] text-muted">
              Drop the {month === "2026-09" ? "September" : "October"} bank
              statement, or use the sample. Exact rules first, then memory, then
              the agent.
            </p>
          </div>
          <button
            type="button"
            disabled={running}
            onClick={() => void run()}
            className="shrink-0 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-paper hover:opacity-90 disabled:opacity-60"
          >
            {running ? "Running…" : "Run allocation"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {(
            [
              ["exact", "Exact rules"],
              ["memory", "Memory"],
              ["agent", "Agent"],
            ] as const
          ).map(([key, label]) => {
            const on =
              progress.stage === key ||
              (progress.stage === "done" && true) ||
              (progress.stage === "memory" && key === "exact") ||
              (progress.stage === "agent" && key !== "agent");
            return (
              <div
                key={key}
                className={`rounded-full border px-2.5 py-1 text-[12px] font-medium ${
                  on
                    ? "border-ink bg-fill text-ink underline decoration-ink decoration-2 underline-offset-4"
                    : "border-hairline text-muted"
                }`}
              >
                {label}
              </div>
            );
          })}
        </div>
      </section>

      {error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-wash px-3 py-2.5 text-[13px] text-danger">
          {error}{" "}
          <button className="underline" type="button" onClick={() => void run()}>
            Retry
          </button>
        </div>
      ) : null}

      {loading && !summary ? (
        <EmptyState title="Loading statement…" body="Fetching sample lines." />
      ) : (
        <>
          <KpiStrip>
            <KpiCard
              label="Receipts"
              value={summary?.total_lines ?? 0}
              hint={summary ? gbp(summary.total_value) : "—"}
            />
            <KpiCard
              label="Auto-allocated"
              value={`${Math.round(auto * 100)}%`}
              hint="no human touch"
              accent="teal"
            />
            <KpiCard
              label="In queue"
              value={queue}
              hint="needs a person"
              accent="amber"
            />
            <KpiCard
              label="Unallocated value"
              value={
                <Money
                  value={summary?.unallocated_value ?? 0}
                  danger={(summary?.unallocated_value ?? 0) > 0}
                />
              }
              accent={(summary?.unallocated_value ?? 0) > 0 ? "red" : undefined}
            />
            {summary?.score ? (
              <KpiCard
                label="Precision"
                value={`${Math.round(summary.score.precision * 100)}%`}
                hint={`${summary.score.wrong_allocations} wrong`}
              />
            ) : null}
          </KpiStrip>

          <AllocationBar exact={exact} memory={memory} agent={agent} queue={queue} />

          {month === "2026-10" && memoryCount > 0 ? (
            <div className="rounded-lg border border-hairline border-l-[3px] border-l-memory bg-sheet px-3 py-2.5 text-[13px]">
              <span className="font-medium text-ink">
                {memoryCount} receipts matched from memory
              </span>
              <span className="text-muted">
                {" "}
                — payers you approved last month.
              </span>
            </div>
          ) : null}

          <section className="overflow-hidden rounded-[12px] border border-hairline bg-sheet">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2 border-b border-hairline px-3 pt-2">
              <div className="flex gap-0">
                {(
                  [
                    ["all", "All"],
                    ["exact", "Exact"],
                    ["memory", "Memory"],
                    ["agent", "Agent"],
                    ["queue", "In queue"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setFilter(id)}
                    className={`-mb-px border-b-2 px-2.5 pb-2 text-[13px] font-medium ${
                      filter === id
                        ? "border-ink text-ink"
                        : "border-transparent text-muted hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search payer or reference"
                className="mb-1.5 ml-auto min-w-[200px] rounded-lg border border-hairline bg-paper px-2.5 py-1 text-[13px]"
              />
            </div>

            <div className="max-h-[560px] overflow-auto">
              <table className="w-full min-w-[960px] border-collapse text-left">
                <thead className="sticky top-0 bg-fill">
                  <tr className="border-b border-hairline text-[12px] font-medium tracking-[0.04em] text-muted">
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Payer</th>
                    <th className="px-3 py-2 font-medium">Reference</th>
                    <th className="px-3 py-2 font-medium text-right">Amount</th>
                    <th className="px-3 py-2 font-medium">Allocated to</th>
                    <th className="px-3 py-2 font-medium">Method</th>
                    <th className="px-3 py-2 font-medium">Confidence</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => {
                    const tenant = l.allocations[0];
                    return (
                      <tr
                        key={l.id}
                        onClick={() => setSelected(l)}
                        className="h-11 cursor-pointer border-b border-hairline hover:bg-fill"
                      >
                        <td className="px-3 text-[13px]">{shortDate(l.date)}</td>
                        <td className="px-3 font-medium">{l.payer_name}</td>
                        <td className="px-3 font-mono text-[12px]">{l.reference}</td>
                        <td className="px-3">
                          <Money value={l.amount} />
                        </td>
                        <td className="px-3 text-[13px] text-muted">
                          {tenant
                            ? `${tenant.tenant_name} · ${tenant.charge_id}`
                            : "—"}
                        </td>
                        <td className="px-3">
                          <MethodBadge method={l.method} status={l.status} />
                        </td>
                        <td className="px-3">
                          <ConfidenceMeter value={l.confidence} />
                        </td>
                        <td className="px-3 text-[13px] capitalize text-muted">
                          {l.status ?? "pending"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {selected ? (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-ink/25"
          onClick={() => setSelected(null)}
        >
          <aside
            className="h-full w-full max-w-md overflow-auto border-l border-hairline bg-sheet p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[12px] font-medium tracking-[0.04em] text-muted">
                  Receipt
                </div>
                <h2 className="mt-0.5 text-[20px] font-medium tracking-[-0.02em]">
                  {selected.payer_name}
                </h2>
                <div className="mt-0.5 font-mono text-[12px] text-muted">
                  {selected.reference}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-[13px] text-muted hover:text-ink"
              >
                Close
              </button>
            </div>
            <div className="mt-3">
              <Money value={selected.amount} large />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <MethodBadge method={selected.method} status={selected.status} />
              <ConfidenceMeter value={selected.confidence} />
            </div>
            {selected.reasoning ? (
              <p className="mt-3 text-[14px] leading-snug">{selected.reasoning}</p>
            ) : null}
            <div className="mt-4 space-y-1.5">
              {selected.allocations.map((a) => (
                <div
                  key={a.charge_id}
                  className="rounded-lg border border-hairline px-2.5 py-2 text-[13px]"
                >
                  <div className="font-medium">{a.tenant_name}</div>
                  <div className="text-[12px] text-muted">
                    {a.charge_id} · {a.charge_type.replace("_", " ")} · {a.period}
                  </div>
                  <div className="mt-1 flex justify-between text-[12px]">
                    <span className="text-muted">Allocated</span>
                    <Money value={a.allocated} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              <div className="text-[12px] font-medium tracking-[0.04em] text-muted">
                Evidence
              </div>
              {selected.evidence.map((e, i) => (
                <EvidenceCard key={`${e.ref}-${i}`} item={e} />
              ))}
            </div>
            {selected.status === "proposed" ? (
              <Link
                href="/exceptions"
                className="mt-5 inline-flex rounded-lg bg-ink px-3 py-2 text-[13px] font-medium text-paper"
              >
                Review in Exceptions
              </Link>
            ) : null}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
