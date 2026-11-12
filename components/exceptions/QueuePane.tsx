"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, X } from "lucide-react";
import { Money } from "@/components/shared";
import { gbp, pct } from "@/lib/format";
import type { LineView } from "@/lib/types";

export type QueueGroup = {
  reason: string;
  items: LineView[];
};

function QueueItem({
  line,
  selected,
  leaving,
  onSelect,
}: {
  line: LineView;
  selected: boolean;
  leaving: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <motion.button
      type="button"
      data-line-id={line.id}
      initial={false}
      animate={leaving ? { x: -24, opacity: 0 } : { x: 0, opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: leaving ? 0.16 : 0.15, ease: "easeOut" }}
      onClick={() => onSelect(line.id)}
      aria-current={selected ? "true" : undefined}
      className={`flex h-14 w-full flex-col justify-center gap-0.5 overflow-hidden border-b border-l-2 border-b-line px-4 text-left ${
        selected ? "border-l-ink bg-canvas" : "border-l-transparent hover:bg-canvas"
      }`}
    >
      <span className="flex items-baseline gap-3">
        <span className="mono min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
          {line.payer_name}
        </span>
        <Money value={line.amount} className="font-medium" />
      </span>
      <span className="flex items-baseline gap-3">
        <span className="mono min-w-0 flex-1 truncate text-[12px] text-muted">
          {line.reference}
        </span>
        {line.confidence != null ? (
          <span className="mono text-[11px] text-muted">{pct(line.confidence)}</span>
        ) : null}
      </span>
    </motion.button>
  );
}

export function QueuePane({
  count,
  shown,
  total,
  groups,
  query,
  onQuery,
  reasons,
  reasonFilter,
  onReasonFilter,
  selectedId,
  leavingId,
  onSelect,
}: {
  count: number;
  shown: number;
  total: number;
  groups: QueueGroup[];
  query: string;
  onQuery: (q: string) => void;
  reasons: { reason: string; count: number }[];
  reasonFilter: string | null;
  onReasonFilter: (r: string | null) => void;
  selectedId: string | null;
  leavingId: string | null;
  onSelect: (id: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const row = listRef.current.querySelector<HTMLElement>(
      `[data-line-id="${CSS.escape(selectedId)}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[8px] border border-line bg-surface">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
        <span className="text-[13px] font-medium text-ink">
          <span className="mono">{count}</span> to review
          {shown !== count ? (
            <span className="ml-1.5 text-[12px] font-normal text-muted">
              · <span className="mono">{shown}</span> shown
            </span>
          ) : null}
        </span>
        <span className="money text-[12px] text-muted">{gbp(total)}</span>
      </header>
      <div className="shrink-0 space-y-2 border-b border-line px-3 py-2.5">
        <label className="flex h-8 items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 focus-within:border-ink">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Payer, reference, tenant or amount"
            aria-label="Search the queue"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
          />
          {query ? (
            <button type="button" onClick={() => onQuery("")} aria-label="Clear search" className="text-muted hover:text-ink">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </label>
        {reasons.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {[{ reason: null as string | null, count: reasons.reduce((s, r) => s + r.count, 0) }, ...reasons].map((r) => {
              const on = reasonFilter === r.reason;
              return (
                <button
                  key={r.reason ?? "all"}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onReasonFilter(on && r.reason ? null : r.reason)}
                  className={`inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium ${
                    on ? "border-ink bg-ink text-surface" : "border-line text-ink hover:bg-canvas"
                  }`}
                >
                  {r.reason ?? "All"}
                  <span className={`mono ${on ? "text-surface/70" : "text-muted"}`}>{r.count}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-auto overscroll-contain">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <span className="text-[13px] font-medium text-ink">No receipts match</span>
            <button
              type="button"
              onClick={() => {
                onQuery("");
                onReasonFilter(null);
              }}
              className="rounded-[8px] border border-line px-2.5 py-1 text-[12px] text-ink hover:bg-canvas"
            >
              Clear filters
            </button>
          </div>
        ) : null}
        {groups.map((group) => (
          <div key={group.reason}>
            <div className="label sticky top-0 z-10 flex h-8 items-center justify-between border-b border-line bg-canvas px-4">
              <span>{group.reason}</span>
              <span className="mono">{group.items.length}</span>
            </div>
            <AnimatePresence initial={false}>
              {group.items.map((line) => (
                <QueueItem
                  key={line.id}
                  line={line}
                  selected={line.id === selectedId}
                  leaving={line.id === leavingId}
                  onSelect={onSelect}
                />
              ))}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </section>
  );
}
