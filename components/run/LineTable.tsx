"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ConfidenceMeter, MethodBadge, Money } from "@/components/shared";
import { shortDate } from "@/lib/format";
import type { LineView, Method } from "@/lib/types";

export type LineFilter = "all" | Method | "queue";

const ROW_HEIGHT = 44;
const OVERSCAN = 8;
const COLS = ["9%", "17%", "14%", "12%", "18%", "10%", "12%", "8%"];

const FILTERS: { id: LineFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "exact", label: "Exact" },
  { id: "memory", label: "Memory" },
  { id: "agent", label: "Agent" },
  { id: "queue", label: "In queue" },
];

function allocatedTo(line: LineView) {
  const first = line.allocations[0];
  if (!first) return "—";
  const extra = line.allocations.length - 1;
  const label = `${first.tenant_name} · ${first.charge_id}`;
  return extra > 0 ? `${label} +${extra}` : label;
}

function StatusCell({ status }: { status: LineView["status"] }) {
  if (status == null) return <MethodBadge method={null} />;
  if (status === "proposed") {
    return <span className="pill pill-med">In queue</span>;
  }
  if (status === "approved") {
    return <span className="pill pill-high">Approved</span>;
  }
  return <span className="pill pill-none">Rejected</span>;
}

function ColGroup() {
  return (
    <colgroup>
      {COLS.map((width, index) => (
        <col key={index} style={{ width }} />
      ))}
    </colgroup>
  );
}

export function LineTable({
  lines,
  month,
  filter,
  query,
  selectedId,
  onFilter,
  onQuery,
  onSelect,
}: {
  lines: LineView[];
  month: string;
  filter: LineFilter;
  query: string;
  selectedId: string | null;
  onFilter: (filter: LineFilter) => void;
  onQuery: (query: string) => void;
  onSelect: (id: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const seenMethod = useRef<Map<string, boolean>>(new Map());
  const rowsRef = useRef<LineView[]>([]);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(480);
  const [theadHeight, setTheadHeight] = useState(36);
  const [resolving, setResolving] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return lines.filter((line) => {
      if (filter === "queue" && line.status !== "proposed") return false;
      if (filter !== "all" && filter !== "queue" && line.method !== filter) return false;
      if (!needle) return true;
      return (
        line.payer_name.toLowerCase().includes(needle) ||
        line.reference.toLowerCase().includes(needle)
      );
    });
  }, [lines, filter, query]);

  const methodKey = rows.map((line) => (line.method ? line.id : "")).filter(Boolean).join(",");
  const lineKey = rows.map((line) => line.id).join(",");
  rowsRef.current = rows;

  useEffect(() => {
    seenMethod.current = new Map();
    setResolving(new Set());
  }, [month]);

  useEffect(() => {
    const current = rowsRef.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fresh: string[] = [];
    for (const line of current) {
      const previous = seenMethod.current.get(line.id);
      const hasMethod = line.method != null;
      if (!reduced && previous === false && hasMethod) fresh.push(line.id);
      seenMethod.current.set(line.id, hasMethod);
    }
    if (fresh.length === 0) return;
    setResolving((existing) => {
      const next = new Set(existing);
      for (const id of fresh) next.add(id);
      return next;
    });
    const timeout = window.setTimeout(() => {
      setResolving((existing) => {
        const next = new Set(existing);
        for (const id of fresh) next.delete(id);
        return next;
      });
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [methodKey, lineKey, month]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const thead = theadRef.current;
    if (!scroller) return;
    const measure = () => {
      setViewport(scroller.clientHeight);
      if (thead) setTheadHeight(thead.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    if (thead) observer.observe(thead);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTop = 0;
    setScrollTop(0);
  }, [filter, query, month]);

  const rowViewport = Math.max(ROW_HEIGHT, viewport - theadHeight);
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(rowViewport / ROW_HEIGHT) + OVERSCAN * 2;
  const end = Math.min(rows.length, start + visibleCount);
  const topPad = start * ROW_HEIGHT;
  const bottomPad = Math.max(0, (rows.length - end) * ROW_HEIGHT);
  const slice = rows.slice(start, end);

  return (
    <section className="card flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 border-b border-hairline px-4 pt-2">
        <div className="flex gap-6" role="tablist">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              onClick={() => onFilter(item.id)}
              className="tab"
            >
              {item.label}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search payer or reference"
          aria-label="Search payer or reference"
          className="mb-1.5 ml-auto min-w-[220px] rounded-md border border-hairline bg-card px-2.5 py-1.5 text-[13px] focus:border-primary focus:outline-none"
        />
      </div>
      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <table className="w-full min-w-[960px] table-fixed border-separate border-spacing-0 text-left">
          <ColGroup />
          <thead ref={theadRef} className="sticky top-0 z-10 bg-card">
            <tr className="text-[12px] font-medium text-muted">
              <th className="border-b border-hairline px-3 py-2.5 font-medium">Date</th>
              <th className="border-b border-hairline px-3 py-2.5 font-medium">Payer</th>
              <th className="border-b border-hairline px-3 py-2.5 font-medium">Reference</th>
              <th className="border-b border-hairline px-3 py-2.5 text-right font-medium">
                Amount
              </th>
              <th className="border-b border-hairline px-3 py-2.5 font-medium">
                Allocated to
              </th>
              <th className="border-b border-hairline px-3 py-2.5 font-medium">Method</th>
              <th className="border-b border-hairline px-3 py-2.5 font-medium">Confidence</th>
              <th className="border-b border-hairline px-3 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {topPad > 0 ? (
              <tr aria-hidden="true" style={{ height: topPad }}>
                <td colSpan={8} style={{ height: topPad, padding: 0, border: 0 }} />
              </tr>
            ) : null}
            {slice.map((line) => {
              const allocated = allocatedTo(line);
              const selected = line.id === selectedId;
              return (
                <tr
                  key={line.id}
                  data-line-id={line.id}
                  onClick={() => onSelect(line.id)}
                  className={`cursor-pointer hover:bg-canvas ${
                    resolving.has(line.id) ? "run-row-resolve" : ""
                  } ${selected ? "bg-primary/5" : ""}`}
                  style={{ height: ROW_HEIGHT }}
                >
                  <td className="h-11 whitespace-nowrap px-3 text-[13px] shadow-[inset_0_-1px_0_var(--hairline)]">
                    {shortDate(line.date)}
                  </td>
                  <td
                    className="h-11 max-w-0 truncate px-3 font-medium shadow-[inset_0_-1px_0_var(--hairline)]"
                    title={line.payer_name}
                  >
                    {line.payer_name}
                  </td>
                  <td
                    className="h-11 max-w-0 truncate px-3 font-mono text-[12px] shadow-[inset_0_-1px_0_var(--hairline)]"
                    title={line.reference}
                  >
                    {line.reference}
                  </td>
                  <td className="h-11 px-3 text-right shadow-[inset_0_-1px_0_var(--hairline)]">
                    <Money value={line.amount} />
                  </td>
                  <td
                    className="h-11 max-w-0 truncate px-3 text-[13px] text-muted shadow-[inset_0_-1px_0_var(--hairline)]"
                    title={allocated}
                  >
                    {allocated}
                  </td>
                  <td className="h-11 whitespace-nowrap px-3 shadow-[inset_0_-1px_0_var(--hairline)]">
                    <MethodBadge method={line.method} />
                  </td>
                  <td className="h-11 px-3 shadow-[inset_0_-1px_0_var(--hairline)]">
                    <ConfidenceMeter value={line.confidence} />
                  </td>
                  <td className="h-11 whitespace-nowrap px-3 shadow-[inset_0_-1px_0_var(--hairline)]">
                    <StatusCell status={line.status} />
                  </td>
                </tr>
              );
            })}
            {bottomPad > 0 ? (
              <tr aria-hidden="true" style={{ height: bottomPad }}>
                <td colSpan={8} style={{ height: bottomPad, padding: 0, border: 0 }} />
              </tr>
            ) : null}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <div className="px-3 py-6 text-center text-[13px] text-muted">No receipts</div>
        ) : null}
      </div>
    </section>
  );
}
