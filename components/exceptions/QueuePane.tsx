"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
  total,
  groups,
  selectedId,
  leavingId,
  onSelect,
}: {
  count: number;
  total: number;
  groups: QueueGroup[];
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
        </span>
        <span className="money text-[12px] text-muted">{gbp(total)}</span>
      </header>
      <div ref={listRef} className="min-h-0 flex-1 overflow-auto overscroll-contain">
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
