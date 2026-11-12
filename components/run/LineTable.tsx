"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { ConfidenceMeter, MethodBadge, Money, Skeleton } from "@/components/shared";
import { shortDate } from "@/lib/format";
import type { LineView, Method } from "@/lib/types";

export type LineFilter = "all" | Method | "queue";

const ROW_HEIGHT = 44;
const OVERSCAN = 8;
/* Date · Payer · Reference · Allocated to · Method · Amount */
const COLS = ["88px", "22%", "17%", "27%", "17%", "15%"];

const FILTERS: { id: LineFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "exact", label: "Exact" },
  { id: "memory", label: "Memory" },
  { id: "agent", label: "Agent" },
  { id: "queue", label: "In queue" },
];

function byDate(a: LineView, b: LineView) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function AllocatedTo({ line }: { line: LineView }) {
  const first = line.allocations[0];
  if (!first) return <span className="text-[13px] text-muted">—</span>;
  const extra = line.allocations.length - 1;
  return (
    <div className="min-w-0 leading-[16px]">
      <div className="truncate text-[13px] text-ink" title={first.tenant_name}>
        {first.tenant_name}
      </div>
      <div className="mono whitespace-nowrap text-[12px] text-muted">
        {first.charge_id}
        {extra > 0 ? <span className="ml-1.5 text-muted">+{extra}</span> : null}
      </div>
    </div>
  );
}

const TH = "label sticky top-0 z-10 h-9 border-b border-line bg-surface px-3 text-left align-middle";
const TD = "border-b border-line px-3 align-middle";

export function LineTable({
  lines,
  month,
  loading,
  filter,
  query,
  selectedId,
  onFilter,
  onQuery,
  onSelect,
}: {
  lines: LineView[];
  month: string;
  loading: boolean;
  filter: LineFilter;
  query: string;
  selectedId: string | null;
  onFilter: (filter: LineFilter) => void;
  onQuery: (query: string) => void;
  onSelect: (id: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(480);
  const [theadHeight, setTheadHeight] = useState(36);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return lines
      .filter((line) => {
        if (filter === "queue" && line.status !== "proposed") return false;
        if (filter !== "all" && filter !== "queue" && line.method !== filter) return false;
        if (!needle) return true;
        return (
          line.payer_name.toLowerCase().includes(needle) ||
          line.reference.toLowerCase().includes(needle)
        );
      })
      .sort(byDate);
  }, [lines, filter, query]);

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
  const initialLoad = loading && lines.length === 0;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[8px] border border-line bg-surface">
      <div className="flex h-11 shrink-0 items-center gap-4 border-b border-line px-3">
        <div className="flex h-full items-stretch">
          {FILTERS.map((item) => {
            const on = filter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onFilter(item.id)}
                aria-pressed={on}
                className={`-mb-px border-b-2 px-2.5 text-[13px] font-medium ${
                  on ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        <span className="mono ml-auto text-[12px] text-muted">
          {rows.length} of {lines.length}
        </span>
        <label className="flex h-8 w-[260px] items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 focus-within:border-ink">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search payer or reference"
            aria-label="Search payer or reference"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
          />
        </label>
      </div>
      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <table className="w-full min-w-[960px] table-fixed border-separate border-spacing-0">
          <colgroup>
            {COLS.map((width, index) => (
              <col key={index} style={{ width }} />
            ))}
          </colgroup>
          <thead ref={theadRef}>
            <tr>
              <th className={TH}>Date</th>
              <th className={TH}>Payer</th>
              <th className={TH}>Reference</th>
              <th className={TH}>Allocated to</th>
              <th className={TH}>Method</th>
              <th className={`${TH} text-right`}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {topPad > 0 ? (
              <tr aria-hidden="true">
                <td colSpan={6} style={{ height: topPad, padding: 0, border: 0 }} />
              </tr>
            ) : null}
            {slice.map((line) => {
              const selected = line.id === selectedId;
              return (
                <tr
                  key={line.id}
                  data-line-id={line.id}
                  onClick={() => onSelect(line.id)}
                  className={`cursor-pointer ${selected ? "bg-canvas" : "hover:bg-canvas"}`}
                  style={{ height: ROW_HEIGHT }}
                >
                  <td className={`${TD} mono whitespace-nowrap text-[12px] text-muted`}>
                    {shortDate(line.date)}
                  </td>
                  <td
                    className={`${TD} mono truncate text-[13px] font-medium text-ink`}
                    title={line.payer_name}
                  >
                    {line.payer_name}
                  </td>
                  <td className={`${TD} mono truncate text-[12px] text-muted`} title={line.reference}>
                    {line.reference}
                  </td>
                  <td className={TD}>
                    <AllocatedTo line={line} />
                  </td>
                  <td className={TD}>
                    <span className="flex items-center gap-2.5 whitespace-nowrap">
                      <MethodBadge method={line.method} status={line.status} />
                      <ConfidenceMeter value={line.confidence} />
                    </span>
                  </td>
                  <td className={`${TD} text-right`}>
                    <Money value={line.amount} className="font-medium" />
                  </td>
                </tr>
              );
            })}
            {bottomPad > 0 ? (
              <tr aria-hidden="true">
                <td colSpan={6} style={{ height: bottomPad, padding: 0, border: 0 }} />
              </tr>
            ) : null}
          </tbody>
        </table>
        {initialLoad ? <Skeleton rows={8} /> : null}
        {!initialLoad && rows.length === 0 ? (
          <div className="flex flex-col items-center px-3 py-12 text-center">
            <div className="text-[14px] font-medium text-ink">
              {lines.length === 0 ? "No statement loaded" : "No receipts match"}
            </div>
            <p className="mt-1 text-[13px] text-muted">
              {lines.length === 0
                ? "Pick a month or reset the demo to load the sample statement."
                : "Clear the search or pick another filter."}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
