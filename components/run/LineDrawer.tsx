"use client";

import { useEffect } from "react";
import Link from "next/link";
import { canFindMatch, useFindMatch } from "@/components/match/FindMatch";
import { ConfidenceMeter, EvidenceCard, MethodBadge, Money } from "@/components/shared";
import type { LineView } from "@/lib/types";

export function LineDrawer({
  line,
  onClose,
}: {
  line: LineView | null;
  onClose: () => void;
}) {
  const { openFindMatch } = useFindMatch();
  useEffect(() => {
    if (!line) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [line, onClose]);

  if (!line) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-ink/25"
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={line.payer_name}
        className="h-full w-full max-w-[420px] overflow-auto border-l border-line bg-surface p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12px] font-medium tracking-[0.04em] text-muted">
              Receipt
            </div>
            <h2 className="mt-0.5 text-[20px] font-medium leading-tight tracking-[-0.02em]">
              {line.payer_name}
            </h2>
            <div className="mt-0.5 truncate font-mono text-[12px] text-muted">
              {line.reference}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-[13px] text-muted hover:text-ink"
          >
            Close
          </button>
        </div>
        <div className="mt-3">
          <Money value={line.amount} size="kpi" />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <MethodBadge method={line.method} status={line.status} />
          <ConfidenceMeter value={line.confidence} />
        </div>
        {line.reasoning ? (
          <p className="mt-3 text-[14px] leading-snug">{line.reasoning}</p>
        ) : null}
        {line.allocations.length > 0 ? (
          <div className="mt-4 space-y-1.5">
            {line.allocations.map((allocation) => (
              <div
                key={allocation.charge_id}
                className="rounded-lg border border-line px-2.5 py-2 text-[13px]"
              >
                <div className="font-medium">{allocation.tenant_name}</div>
                <div className="text-[12px] text-muted">
                  {allocation.charge_id} · {allocation.period}
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 text-[12px]">
                  <span className="text-muted">Allocated</span>
                  <Money value={allocation.allocated} />
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {line.evidence.length > 0 ? (
          <div className="mt-4 space-y-2">
            <div className="text-[12px] font-medium tracking-[0.04em] text-muted">
              Evidence
            </div>
            {line.evidence.map((item, index) => (
              <EvidenceCard key={`${item.type}-${item.ref}-${index}`} item={item} />
            ))}
          </div>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          {line.status === "proposed" ? (
            <Link
              href="/exceptions"
              className="inline-flex rounded-lg bg-ink px-3 py-2 text-[13px] font-medium text-canvas"
            >
              Review in Exceptions
            </Link>
          ) : null}
          {canFindMatch(line) ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                openFindMatch(line);
              }}
              className="inline-flex rounded-lg border border-line px-3 py-2 text-[13px] font-medium text-ink hover:bg-canvas"
            >
              Find match
            </button>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
