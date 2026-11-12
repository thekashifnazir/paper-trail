"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";
import { KpiCard, KpiStrip, Money } from "@/components/shared";
import { gbp, pct } from "@/lib/format";
import type { LineView, RunSummary } from "@/lib/types";

/** 250ms ease-out count-up via Framer Motion; jumps straight to the value under reduced motion. */
function useCountUp(target: number) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    if (reduced || fromRef.current === target) {
      fromRef.current = target;
      setDisplay(target);
      return;
    }
    const controls = animate(fromRef.current, target, {
      duration: 0.25,
      ease: "easeOut",
      onUpdate: (value) => {
        fromRef.current = value;
        setDisplay(value);
      },
    });
    return () => controls.stop();
  }, [target, reduced]);

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

function Figure({ children, tone }: { children: React.ReactNode; tone?: "muted" }) {
  return (
    <span className={`money tracking-[-0.03em] ${tone === "muted" ? "text-muted" : "text-ink"}`}>
      {children}
    </span>
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
  const queued = lines.filter((line) => line.status === "proposed");
  const queue = queued.length;
  const queueValue = queued.reduce((sum, line) => sum + line.amount, 0);
  const unallocated = unallocatedValue(lines);
  const unallocatedLines = lines.filter(
    (line) =>
      (line.status === "proposed" && line.unallocated_amount > 0) || line.status === null,
  ).length;
  const autoRate = receipts > 0 ? approved / receipts : 0;

  const receiptsN = useCountUp(receipts);
  const rateN = useCountUp(started ? autoRate : 0);
  const queueN = useCountUp(queue);
  const unallocatedN = useCountUp(unallocated);
  const precisionN = useCountUp(score?.precision ?? 0);

  return (
    <KpiStrip>
      <KpiCard
        label="Receipts"
        value={<Figure>{Math.round(receiptsN)}</Figure>}
        hint={receipts > 0 ? <span className="money">{gbp(totalValue)} received</span> : "No statement loaded"}
      />
      <KpiCard
        label="Auto-allocated"
        value={started ? <Figure>{pct(rateN)}</Figure> : <Figure tone="muted">—</Figure>}
        hint={started ? `${approved} of ${receipts}, no human touch` : "Run to allocate"}
      />
      <KpiCard
        label="In queue"
        value={started ? <Figure>{Math.round(queueN)}</Figure> : <Figure tone="muted">—</Figure>}
        hint={
          !started ? (
            "Awaiting run"
          ) : queue > 0 ? (
            <span>
              <span className="money">{gbp(queueValue)}</span> awaiting review
            </span>
          ) : (
            "Nothing to review"
          )
        }
      />
      <KpiCard
        label="Unallocated value"
        value={
          started ? (
            <Money
              value={unallocatedN}
              size="kpi"
              tone={unallocated > 0.004 ? "risk" : undefined}
            />
          ) : (
            <Figure tone="muted">—</Figure>
          )
        }
        hint={
          started
            ? unallocated > 0.004
              ? `Across ${unallocatedLines} receipt${unallocatedLines === 1 ? "" : "s"}`
              : "Every pound placed"
            : "Awaiting run"
        }
      />
      <KpiCard
        label="Precision"
        value={score ? <Figure>{pct(precisionN)}</Figure> : <Figure tone="muted">—</Figure>}
        hint={
          score
            ? `${score.wrong_allocations} wrong allocation${score.wrong_allocations === 1 ? "" : "s"}`
            : "Scored after run"
        }
      />
    </KpiStrip>
  );
}
