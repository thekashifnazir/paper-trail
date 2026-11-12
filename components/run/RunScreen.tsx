"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AllocationBar } from "@/components/shared";
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

function barCounts(lines: LineView[]) {
  let exact = 0;
  let memory = 0;
  let agent = 0;
  let queue = 0;
  for (const line of lines) {
    if (line.status === "proposed") queue += 1;
    if (line.status !== "approved") continue;
    if (line.method === "exact") exact += 1;
    else if (line.method === "memory") memory += 1;
    else if (line.method === "agent") agent += 1;
  }
  return { exact, memory, agent, queue };
}

export function RunScreen() {
  const { month, lines, summary, progress, error, run } = useStore();
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

  const counts = useMemo(() => barCounts(monthLines), [monthLines]);
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
        error={error}
        onRun={startRun}
      />
      {hasRun && !running ? (
        <div className="flex items-center gap-3 border-b border-hairline px-1 pb-2 text-[14px]">
          <span>
            <span className="font-mono tabular-nums">{counts.exact + counts.memory + counts.agent}</span> matched ·{" "}
            <span className="font-mono tabular-nums">{counts.queue}</span> need you
          </span>
          {counts.queue > 0 ? (
            <Link href="/exceptions" className="font-medium text-ink underline underline-offset-2">
              Review {counts.queue} →
            </Link>
          ) : null}
        </div>
      ) : null}
      <KpiRow lines={monthLines} started={running || hasRun} score={monthSummary?.score} />
      <div className="run-bar">
        <AllocationBar
          exact={counts.exact}
          memory={counts.memory}
          agent={counts.agent}
          queue={counts.queue}
        />
      </div>
      {month === "2026-10" && memoryCount > 0 ? (
        <div className="rounded-md border-l-4 border-[#bef264] bg-ink px-4 py-3 text-[14px] text-paper">
          <span className="font-semibold text-[#bef264]">
            {memoryCount} receipts matched from memory
          </span>
          <span className="text-white/80"> — payers you approved last month.</span>
        </div>
      ) : null}
      <LineTable
        lines={monthLines}
        month={month}
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
