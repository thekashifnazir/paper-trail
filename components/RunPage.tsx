"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AllocationBar,
  ConfidenceMeter,
  EmptyState,
  EvidenceCard,
  KpiCard,
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
    <div className="space-y-5">
      <section className="rounded-lg border border-line bg-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-[28px] tracking-tight">
              Cash application
            </h1>
            <p className="mt-1 max-w-2xl text-muted">
              Drop the {month === "2026-09" ? "September" : "October"} bank
              statement, or use the sample. Exact rules first, then memory, then
              the agent.
            </p>
          </div>
          <button
            type="button"
            disabled={running}
            onClick={() => void run()}
            className="rounded-md bg-brand px-4 py-2.5 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {running ? "Running…" : "Run allocation"}
          </button>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-3">
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
                className={`rounded-md border px-3 py-2 text-[13px] font-medium ${
                  on
                    ? "border-brand bg-brand-wash text-brand"
                    : "border-line text-muted"
                }`}
              >
                {label}
              </div>
            );
          })}
        </div>
      </section>

      {error ? (
        <div className="rounded-md border border-danger/30 bg-red-50 px-4 py-3 text-danger">
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
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
              value={<Money value={summary?.unallocated_value ?? 0} danger={(summary?.unallocated_value ?? 0) > 0} />}
              accent={(summary?.unallocated_value ?? 0) > 0 ? "red" : undefined}
            />
            {summary?.score ? (
              <KpiCard
                label="Precision"
                value={`${Math.round(summary.score.precision * 100)}%`}
                hint={`${summary.score.wrong_allocations} wrong`}
              />
            ) : null}
          </div>

          <AllocationBar exact={exact} memory={memory} agent={agent} queue={queue} />

          {month === "2026-10" && memoryCount > 0 ? (
            <div className="rounded-md border-l-4 border-brand bg-ink px-4 py-3 text-paper">
              <span className="font-semibold text-[#bef264]">
                {memoryCount} receipts matched from memory
              </span>
              <span className="text-white/80">
                {" "}
                — payers you approved last month.
              </span>
            </div>
          ) : null}

          <section className="rounded-lg border border-line bg-panel">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
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
                  className={`rounded-full px-3 py-1 text-[13px] font-medium ${
                    filter === id
                      ? "bg-ink text-paper"
                      : "bg-line/70 text-ink hover:bg-line"
                  }`}
                >
                  {label}
                </button>
              ))}
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search payer or reference"
                className="ml-auto min-w-[220px] rounded-md border border-line bg-paper px-3 py-1.5 text-[14px]"
              />
            </div>

            <div className="max-h-[520px] overflow-auto">
              <table className="w-full min-w-[960px] border-collapse text-left">
                <thead className="sticky top-0 bg-panel">
                  <tr className="border-b border-line text-[12px] uppercase tracking-[0.06em] text-muted">
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
                        className="h-11 cursor-pointer border-b border-line/80 hover:bg-brand-wash/40"
                      >
                        <td className="px-3 text-[13px]">{shortDate(l.date)}</td>
                        <td className="px-3 font-medium">{l.payer_name}</td>
                        <td className="px-3 font-mono text-[13px]">{l.reference}</td>
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
                        <td className="px-3 capitalize text-[13px] text-muted">
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
        <div className="fixed inset-0 z-40 flex justify-end bg-ink/30" onClick={() => setSelected(null)}>
          <aside
            className="h-full w-full max-w-md overflow-auto border-l border-line bg-panel p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[12px] uppercase tracking-[0.08em] text-muted">
                  Receipt
                </div>
                <h2 className="mt-1 text-[22px] font-semibold">{selected.payer_name}</h2>
                <div className="mt-1 font-mono text-[13px] text-muted">
                  {selected.reference}
                </div>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="text-muted">
                Close
              </button>
            </div>
            <div className="mt-4">
              <Money value={selected.amount} large />
            </div>
            <div className="mt-4 flex items-center gap-3">
              <MethodBadge method={selected.method} status={selected.status} />
              <ConfidenceMeter value={selected.confidence} />
            </div>
            {selected.reasoning ? (
              <p className="mt-4 text-[16px] leading-relaxed">{selected.reasoning}</p>
            ) : null}
            <div className="mt-5 space-y-2">
              {selected.allocations.map((a) => (
                <div key={a.charge_id} className="rounded-md border border-line px-3 py-2 text-[13px]">
                  <div className="font-medium">{a.tenant_name}</div>
                  <div className="text-muted">
                    {a.charge_id} · {a.charge_type.replace("_", " ")} · {a.period}
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span>Allocated</span>
                    <Money value={a.allocated} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 space-y-3">
              <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">
                Evidence
              </div>
              {selected.evidence.map((e, i) => (
                <EvidenceCard key={`${e.ref}-${i}`} item={e} />
              ))}
            </div>
            {selected.status === "proposed" ? (
              <Link
                href="/exceptions"
                className="mt-6 inline-flex rounded-md bg-brand px-3 py-2 text-[14px] font-semibold text-white"
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
