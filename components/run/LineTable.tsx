"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { ConfidenceMeter, MethodBadge, Money, Skeleton } from "@/components/shared";
import { lineMatchesQuery } from "@/lib/filter";
import { shortDate } from "@/lib/format";
import type { LineView, Method } from "@/lib/types";

export type LineFilter = "all" | Method | "queue" | "rejected";

export type LineFilters = {
  reason: string;
  from: string;
  to: string;
  min: string;
  max: string;
};

export const NO_FILTERS: LineFilters = { reason: "", from: "", to: "", min: "", max: "" };

const REASONS = [
  "New payer relationship",
  "Short payment",
  "Overpayment",
  "Possible duplicate payment",
  "Unidentified receipt",
  "Low confidence",
];

function activeFilterCount(f: LineFilters) {
  return Object.values(f).filter((v) => v.trim() !== "").length;
}

function passesFilters(line: LineView, f: LineFilters) {
  if (f.reason && line.review_reason !== f.reason) return false;
  if (f.from && line.date < f.from) return false;
  if (f.to && line.date > f.to) return false;
  const min = Number(f.min);
  if (f.min.trim() && Number.isFinite(min) && line.amount < min) return false;
  const max = Number(f.max);
  if (f.max.trim() && Number.isFinite(max) && line.amount > max) return false;
  return true;
}

function inTab(line: LineView, tab: LineFilter) {
  if (tab === "all") return true;
  if (tab === "queue") return line.status === "proposed";
  if (tab === "rejected") return line.status === "rejected";
  return line.status === "approved" && line.method === tab;
}

const ROW_HEIGHT = 44;
const OVERSCAN = 8;
/* Date · Payer · Reference · Allocated to · Method · Amount */
const COLS = ["88px", "22%", "17%", "27%", "17%", "15%"];

const FILTERS: { id: LineFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "exact", label: "Exact" },
  { id: "memory", label: "Memory" },
  { id: "agent", label: "Agent" },
  { id: "human", label: "Human" },
  { id: "rule", label: "Rule" },
  { id: "queue", label: "In queue" },
  { id: "rejected", label: "Rejected" },
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
  filters,
  selectedId,
  onFilter,
  onQuery,
  onFilters,
  onSelect,
}: {
  lines: LineView[];
  month: string;
  loading: boolean;
  filter: LineFilter;
  query: string;
  filters: LineFilters;
  selectedId: string | null;
  onFilter: (filter: LineFilter) => void;
  onQuery: (query: string) => void;
  onFilters: (filters: LineFilters) => void;
  onSelect: (id: string) => void;
}) {
  const [showFilters, setShowFilters] = useState(false);
  const activeCount = activeFilterCount(filters);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(480);
  const [theadHeight, setTheadHeight] = useState(36);

  const narrowed = useMemo(
    () => lines.filter((line) => lineMatchesQuery(line, query) && passesFilters(line, filters)),
    [lines, query, filters],
  );
  const tabCounts = useMemo(() => {
    const out = {} as Record<LineFilter, number>;
    for (const item of FILTERS) out[item.id] = narrowed.filter((line) => inTab(line, item.id)).length;
    return out;
  }, [narrowed]);
  const rows = useMemo(
    () => narrowed.filter((line) => inTab(line, filter)).sort(byDate),
    [narrowed, filter],
  );
  const filtering = query.trim() !== "" || activeCount > 0 || filter !== "all";

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
  }, [filter, query, filters, month]);

  const rowViewport = Math.max(ROW_HEIGHT, viewport - theadHeight);
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(rowViewport / ROW_HEIGHT) + OVERSCAN * 2;
  const end = Math.min(rows.length, start + visibleCount);
  const topPad = start * ROW_HEIGHT;
  const bottomPad = Math.max(0, (rows.length - end) * ROW_HEIGHT);
  const slice = rows.slice(start, end);
  const initialLoad = loading && lines.length === 0;

  return (
    <section className="run-table flex min-h-0 flex-1 flex-col overflow-hidden rounded-[8px] border border-line bg-surface">
      <div className="flex h-11 shrink-0 items-center gap-4 border-b border-line px-3">
        <div className="flex h-full items-stretch">
          {FILTERS.map((item) => {
            const on = filter === item.id;
            const count = tabCounts[item.id] ?? 0;
            if ((item.id === "human" || item.id === "rule" || item.id === "rejected") && count === 0 && !on) return null;
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
                <span
                  className={`mono ml-1.5 text-[11px] ${
                    item.id === "rejected" && count > 0 ? "text-risk" : "text-muted"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <span className="mono ml-auto text-[12px] text-muted">
          {rows.length} of {lines.length}
        </span>
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          className={`inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2.5 text-[13px] font-medium ${
            showFilters || activeCount > 0 ? "border-ink text-ink" : "border-line text-ink hover:bg-canvas"
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5 text-muted" aria-hidden />
          Filters
          {activeCount > 0 ? (
            <span className="mono rounded-full bg-ink px-1.5 text-[11px] leading-[16px] text-surface">{activeCount}</span>
          ) : null}
        </button>
        <label className="flex h-8 w-[300px] items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 focus-within:border-ink">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Payer, reference, tenant, invoice or amount"
            aria-label="Search receipts"
            title="Search payer, reference, tenant, unit, invoice ref, or an amount (4850, >5000, <100)"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
          />
          {query ? (
            <button type="button" onClick={() => onQuery("")} aria-label="Clear search" className="text-muted hover:text-ink">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </label>
      </div>
      {showFilters || activeCount > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-canvas px-3 py-2 text-[12px]">
          <label className="flex items-center gap-1.5">
            <span className="text-muted">Review reason</span>
            <select
              value={filters.reason}
              onChange={(event) => onFilters({ ...filters, reason: event.target.value })}
              className="h-7 rounded-[6px] border border-line bg-surface px-2 text-[12px] text-ink"
            >
              <option value="">Any</option>
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-muted">Date</span>
            <input
              type="date"
              value={filters.from}
              onChange={(event) => onFilters({ ...filters, from: event.target.value })}
              aria-label="Date from"
              className="mono h-7 rounded-[6px] border border-line bg-surface px-1.5 text-[12px] text-ink"
            />
            <span className="text-muted">to</span>
            <input
              type="date"
              value={filters.to}
              onChange={(event) => onFilters({ ...filters, to: event.target.value })}
              aria-label="Date to"
              className="mono h-7 rounded-[6px] border border-line bg-surface px-1.5 text-[12px] text-ink"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-muted">Amount £</span>
            <input
              inputMode="decimal"
              value={filters.min}
              onChange={(event) => onFilters({ ...filters, min: event.target.value })}
              placeholder="min"
              aria-label="Minimum amount"
              className="mono h-7 w-20 rounded-[6px] border border-line bg-surface px-1.5 text-right text-[12px] text-ink"
            />
            <span className="text-muted">–</span>
            <input
              inputMode="decimal"
              value={filters.max}
              onChange={(event) => onFilters({ ...filters, max: event.target.value })}
              placeholder="max"
              aria-label="Maximum amount"
              className="mono h-7 w-20 rounded-[6px] border border-line bg-surface px-1.5 text-right text-[12px] text-ink"
            />
          </label>
          {filtering ? (
            <button
              type="button"
              onClick={() => {
                onFilters(NO_FILTERS);
                onQuery("");
                onFilter("all");
              }}
              className="ml-auto inline-flex h-7 items-center gap-1 rounded-[6px] px-2 font-medium text-ink hover:bg-surface"
            >
              <X className="h-3.5 w-3.5 text-muted" aria-hidden />
              Clear all
            </button>
          ) : null}
        </div>
      ) : null}
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
                : "Clear the search or filters, or pick another tab."}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
