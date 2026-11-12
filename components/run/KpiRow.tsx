"use client";

import { useEffect, useRef, useState } from "react";
import { KpiCard, KpiStrip, Money } from "@/components/shared";
import { gbp, pct } from "@/lib/format";
import type { LineView, RunSummary } from "@/lib/types";

function useCountUp(target: number, duration = 500) {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const reducedRef = useRef(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      reducedRef.current = media.matches;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const from = displayRef.current;
    if (reducedRef.current || from === target) {
      displayRef.current = target;
      setDisplay(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      const next = from + (target - from) * eased;
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return display;
}

function unallocatedValue(lines: LineView[]) {
  return lines
    .filter((line) => line.status === "proposed" || line.status === null)
    .reduce(
      (sum, line) =>
        sum + (line.unallocated_amount || (line.status === null ? line.amount : 0)),
      0,
    );
}

export function KpiRow({
  lines,
  started,
  score,
}: {
  lines: LineView[];
  started: boolean;
  score?: RunSummary["score"];
}) {
  const receipts = lines.length;
  const totalValue = lines.reduce((sum, line) => sum + line.amount, 0);
  const approved = lines.filter((line) => line.status === "approved").length;
  const queue = lines.filter((line) => line.status === "proposed").length;
  const unallocated = unallocatedValue(lines);

  const receiptsN = useCountUp(receipts);
  const totalValueN = useCountUp(totalValue);
  const approvedN = useCountUp(approved);
  const totalN = useCountUp(receipts);
  const queueN = useCountUp(queue);
  const unallocatedN = useCountUp(unallocated);
  const precisionN = useCountUp(score?.precision ?? 0);

  return (
    <KpiStrip>
      <KpiCard
        label="Receipts"
        value={<span className="tabular">{Math.round(receiptsN)}</span>}
        hint={receipts > 0 ? gbp(totalValueN) : "—"}
      />
      <KpiCard
        label="Auto-allocated"
        value={
          <span className="tabular">
            {Math.round(approvedN)}/{Math.round(totalN)}
          </span>
        }
        hint="no human touch"
      />
      <KpiCard
        label="In queue"
        value={<span className="tabular">{Math.round(queueN)}</span>}
      />
      <KpiCard
        label="Unallocated value"
        value={
          started ? (
            <Money value={unallocatedN} tone={unallocated > 0.004 ? "risk" : undefined} />
          ) : (
            <span className="tabular text-muted">—</span>
          )
        }
      />
      {score ? (
        <KpiCard
          label="Precision"
          value={<span className="tabular">{pct(precisionN)}</span>}
          hint={`${score.wrong_allocations} wrong`}
        />
      ) : null}
    </KpiStrip>
  );
}
