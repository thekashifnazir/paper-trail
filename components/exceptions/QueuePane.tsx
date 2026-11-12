"use client";

import { useEffect, useRef } from "react";
import { ConfidenceMeter, Money } from "@/components/shared";
import { gbp } from "@/lib/format";
import type { LineView } from "@/lib/types";

export type QueueGroup = {
  reason: string;
  items: LineView[];
};

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
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
      <header className="shrink-0 border-b border-line px-3 py-2.5">
        <h1 className="text-[20px] font-medium tracking-[-0.02em] text-ink">
          Exceptions
        </h1>
        <p className="mt-0.5 text-[12px] text-muted">
          {count} to review · {gbp(total)}
        </p>
      </header>
      <div ref={listRef} className="min-h-0 flex-1 overflow-auto overscroll-contain">
        {groups.map((group) => (
          <div key={group.reason}>
            <div className="sticky top-0 z-10 bg-canvas px-3 py-1.5 text-[12px] font-medium tracking-[0.04em] text-muted">
              {group.reason} · {group.items.length}
            </div>
            {group.items.map((line) => {
              const selected = line.id === selectedId;
              const leaving = line.id === leavingId;
              return (
                <button
                  key={line.id}
                  type="button"
                  data-line-id={line.id}
                  onClick={() => onSelect(line.id)}
                  className={`flex w-full items-start gap-2 border-b border-l-2 border-b-line px-3 py-2 text-left transition-opacity duration-[160ms] ease-out motion-reduce:transition-none ${
                    selected
                      ? "border-l-ink bg-canvas"
                      : "border-l-transparent hover:bg-canvas/70"
                  } ${leaving ? "opacity-0" : "opacity-100"}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium leading-snug">
                      {line.payer_name}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted">
                      {line.reference}
                    </div>
                    <div className="mt-1 w-[100px]">
                      <ConfidenceMeter value={line.confidence} />
                    </div>
                  </div>
                  <div className="shrink-0 pt-0.5">
                    <Money value={line.amount} />
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
