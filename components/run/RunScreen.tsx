"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AllocationBar, type BarSegment } from "@/components/shared";
import { getLines } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { LineView } from "@/lib/types";
import { KpiRow } from "./KpiRow";
import { LineDrawer } from "./LineDrawer";
import { LineTable, type LineFilter } from "./LineTable";
import { StatementCard } from "./StatementCard";
import "./run.css";

function monthName(month: string) {
  if (month === "2026-09") return "September";
  if (month === "2026-10") return "October";
  return month;
}

function barSegments(lines: LineView[]): BarSegment[] {
  const seg: Record<BarSegment["key"], BarSegment> = {
    exact: { key: "exact", count: 0, value: 0 },
    memory: { key: "memory", count: 0, value: 0 },
    agent: { key: "agent", count: 0, value: 0 },
    queue: { key: "queue", count: 0, value: 0 },
  };
  for (const line of lines) {
    let key: BarSegment["key"] | null = null;
    if (line.status === "proposed") key = "queue";
    else if (line.status === "approved" && line.method && line.method !== "human") key = line.method;
    if (!key) continue;
    seg[key].count += 1;
    seg[key].value += line.amount;
  }
  return [seg.exact, seg.memory, seg.agent, seg.queue];
}

export function RunScreen() {
  const { month, lines, summary, progress, error, loading, run } = useStore();
  const [running, setRunning] = useState(false);
  const [polled, setPolled] = useState<LineView[] | null>(null);
  const [filter, setFilter] = useState<LineFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const runLock = useRef(false);

  const startRun = useCallback(() => {
    if (runLock.current) return;
    runLock.current = true;
    setRunning(true);
    void run().finally(() => {
      runLock.current = false;
      setRunning(false);
      setPolled(null);
    });
  }, [run]);

  useEffect(() => {
    if (!running) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await getLines(month);
        if (!cancelled) setPolled(next);
      } catch {
        /* The store records the run error. */
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 100);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [running, month]);

  useEffect(() => {
    setPolled(null);
    setSelectedId(null);
    setFilter("all");
    setQuery("");
  }, [month]);

  const monthSummary = summary && summary.month === month ? summary : null;
  const hasRun = monthSummary?.score != null;

  const monthLines = useMemo(() => {
    const source = running && polled ? polled : lines;
    return source.filter((line) => line.statement_month === month);
  }, [running, polled, lines, month]);

  const segments = useMemo(() => barSegments(monthLines), [monthLines]);
  const stepCounts = useMemo(() => {
    const counts = { exact: 0, memory: 0, agent: 0 };
    for (const line of monthLines) {
      if (line.method === "exact" || line.method === "memory" || line.method === "agent") {
        counts[line.method] += 1;
      }
    }
    return counts;
  }, [monthLines]);
  const memoryCount = useMemo(
    () => monthLines.filter((line) => line.method === "memory").length,
    [monthLines],
  );
  const selected = monthLines.find((line) => line.id === selectedId) ?? null;
  const closeDrawer = useCallback(() => setSelectedId(null), []);

  return (
    <div className="run-screen flex min-h-0 flex-col gap-3 overflow-hidden">
      <StatementCard
        monthLabel={monthName(month)}
        running={running}
        hasRun={hasRun}
        stage={progress.stage}
        counts={stepCounts}
        error={error}
        onRun={startRun}
      />
      <KpiRow lines={monthLines} started={running || hasRun} score={monthSummary?.score} />
      <section className="rounded-[8px] border border-line bg-surface px-4 py-3.5">
        <div className="mb-2.5 flex items-baseline justify-between">
          <span className="label">Allocation by method</span>
          <span className="text-[12px] text-muted">Share of receipts</span>
        </div>
        <AllocationBar segments={segments} />
      </section>
      {month === "2026-10" && memoryCount > 0 ? (
        <div className="flex items-center gap-2.5 rounded-[8px] border border-line border-l-[3px] border-l-lime bg-surface px-3.5 py-2.5 text-[14px]">
          <span className="font-medium text-memory">
            {memoryCount} receipts matched from memory
          </span>
          <span className="text-muted"> — payers you approved last month.</span>
        </div>
      ) : null}
      <LineTable
        lines={monthLines}
        month={month}
        loading={loading}
        filter={filter}
        query={query}
        selectedId={selectedId}
        onFilter={setFilter}
        onQuery={setQuery}
        onSelect={setSelectedId}
      />
      <LineDrawer line={selected} onClose={closeDrawer} />
    </div>
  );
}
